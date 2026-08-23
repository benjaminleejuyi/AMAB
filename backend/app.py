"""AppSync Lambda resolver for Askboard's DynamoDB single-table backend."""

from __future__ import annotations

import os
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["TABLE_NAME"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
table = boto3.resource("dynamodb").Table(TABLE_NAME)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _identity(event: dict) -> tuple[str, bool]:
    identity = event.get("identity") or {}
    claims = identity.get("claims") or {}
    username = claims.get("sub") or claims.get("cognito:username")
    if username:
        return str(username), True
    headers = (event.get("request") or {}).get("headers") or {}
    participant = headers.get("x-participant-id")
    return str(participant or f"guest-{uuid.uuid4()}"), False


def _public(item: dict) -> dict:
    return {key: int(value) if isinstance(value, Decimal) else value for key, value in item.items() if key not in {"PK", "SK"}}


def _get_board(board_id: str) -> dict:
    result = table.get_item(Key={"PK": f"BOARD#{board_id}", "SK": "META"}).get("Item")
    if not result:
        raise ValueError("Board not found")
    return result


def _require_board_role(board_id: str, user_id: str, owner_only: bool = False, organisation_admin: bool = False) -> None:
    if organisation_admin:
        return
    board = _get_board(board_id)
    if board["createdBy"] == user_id:
        return
    if not owner_only:
        member = table.get_item(Key={"PK": f"BOARD#{board_id}", "SK": f"MEMBER#{user_id}"}).get("Item")
        if member and member.get("role") == "MODERATOR":
            return
    raise PermissionError("You do not have permission to manage this board")


def create_board(args: dict, user_id: str, authenticated: bool) -> dict:
    if not authenticated:
        raise PermissionError("Sign in to create a board")
    data = args["input"]
    board_id, now = str(uuid.uuid4()), _now()
    item = {
        "PK": f"BOARD#{board_id}", "SK": "META", "entity": "BOARD", "id": board_id,
        "title": data["title"], "description": data.get("description"),
        "visibility": data.get("visibility", "UNLISTED"), "postingPolicy": data.get("postingPolicy", "ANYONE"),
        "votingMode": data.get("votingMode", "UP_DOWN"), "commentsEnabled": data.get("commentsEnabled", True),
        "visibleVoteTotals": True, "presentedQuestionId": None, "createdBy": user_id,
        "createdAt": now, "updatedAt": now,
    }
    table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    return _public(item)


def get_board(args: dict) -> dict:
    return _public(_get_board(args["id"]))


def create_question(args: dict, participant_id: str, authenticated: bool) -> dict:
    data, now = args["input"], _now()
    board = _get_board(data["boardId"])
    if board["postingPolicy"] == "CLOSED":
        raise PermissionError("This board is not accepting questions")
    if board["postingPolicy"] == "AUTHENTICATED" and not authenticated:
        raise PermissionError("Sign in to post on this board")
    question_id = str(uuid.uuid4())
    pseudonym = data.get("identifyAs") or f"Guest {participant_id[-6:].upper()}"
    item = {
        "PK": f"BOARD#{data['boardId']}", "SK": f"QUESTION#{now}#{question_id}",
        "entity": "QUESTION", "id": question_id, "boardId": data["boardId"], "body": data["body"],
        "authorDisplayName": pseudonym, "category": data["category"], "status": "OPEN", "rank": now,
        "upvotes": 0, "downvotes": 0, "comments": [], "createdAt": now, "updatedAt": now,
    }
    table.put_item(Item=item)
    return _public(item)


def _find_question(board_id: str, question_id: str) -> dict:
    items = table.query(
        KeyConditionExpression=Key("PK").eq(f"BOARD#{board_id}") & Key("SK").begins_with("QUESTION#")
    ).get("Items", [])
    question = next((item for item in items if item["id"] == question_id), None)
    if not question:
        raise ValueError("Question not found")
    return question


def list_questions(args: dict) -> dict:
    board_id, limit = args["boardId"], min(args.get("limit") or 100, 100)
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"BOARD#{board_id}") & Key("SK").begins_with("QUESTION#"),
        Limit=limit, ScanIndexForward=False,
    )
    return {"items": [_public(item) for item in result.get("Items", [])], "nextToken": None}


def cast_vote(args: dict, participant_id: str) -> dict:
    data = args["input"]
    if data["value"] not in (-1, 0, 1):
        raise ValueError("Vote must be -1, 0, or 1")
    board = _get_board(data["boardId"])
    if board["votingMode"] == "NONE" or (board["votingMode"] in {"LIKES", "UPVOTE"} and data["value"] < 0):
        raise PermissionError("That vote is not enabled")
    question = _find_question(data["boardId"], data["questionId"])
    vote_key = {"PK": f"QUESTION#{data['questionId']}", "SK": f"VOTE#{participant_id}"}
    previous = table.get_item(Key=vote_key).get("Item", {}).get("value", 0)
    up_delta = int(data["value"] == 1) - int(previous == 1)
    down_delta = int(data["value"] == -1) - int(previous == -1)
    transact = [{"Update": {
        "TableName": TABLE_NAME, "Key": {"PK": {"S": question["PK"]}, "SK": {"S": question["SK"]}},
        "UpdateExpression": "ADD upvotes :up, downvotes :down SET updatedAt = :now",
        "ExpressionAttributeValues": {":up": {"N": str(up_delta)}, ":down": {"N": str(down_delta)}, ":now": {"S": _now()}},
    }}]
    if data["value"] == 0:
        transact.append({"Delete": {"TableName": TABLE_NAME, "Key": {"PK": {"S": vote_key["PK"]}, "SK": {"S": vote_key["SK"]}}}})
    else:
        transact.append({"Put": {"TableName": TABLE_NAME, "Item": {
            "PK": {"S": vote_key["PK"]}, "SK": {"S": vote_key["SK"]}, "value": {"N": str(data["value"])}, "entity": {"S": "VOTE"}
        }}})
    boto3.client("dynamodb").transact_write_items(TransactItems=transact)
    question["upvotes"] += up_delta
    question["downvotes"] += down_delta
    return _public(question)


def add_comment(args: dict, participant_id: str) -> dict:
    data, now = args["input"], _now()
    board = _get_board(data["boardId"])
    if not board["commentsEnabled"]:
        raise PermissionError("Comments are disabled")
    question = _find_question(data["boardId"], data["questionId"])
    comment = {"id": str(uuid.uuid4()), "questionId": data["questionId"], "body": data["body"], "authorDisplayName": f"Guest {participant_id[-6:].upper()}", "createdAt": now}
    table.update_item(Key={"PK": question["PK"], "SK": question["SK"]}, UpdateExpression="SET comments = list_append(if_not_exists(comments, :empty), :comment), updatedAt = :now", ExpressionAttributeValues={":empty": [], ":comment": [comment], ":now": now})
    return comment


def select_question(args: dict, user_id: str) -> dict:
    _require_board_role(args["boardId"], user_id)
    result = table.update_item(Key={"PK": f"BOARD#{args['boardId']}", "SK": "META"}, UpdateExpression="SET presentedQuestionId = :question, updatedAt = :now", ExpressionAttributeValues={":question": args.get("questionId"), ":now": _now()}, ReturnValues="ALL_NEW")
    return _public(result["Attributes"])


def assign_moderator(args: dict, user_id: str) -> dict:
    _require_board_role(args["boardId"], user_id, owner_only=True)
    item = {"PK": f"BOARD#{args['boardId']}", "SK": f"MEMBER#{args['userId']}", "entity": "MEMBER", "boardId": args["boardId"], "userId": args["userId"], "role": "MODERATOR"}
    table.put_item(Item=item)
    return _public(item)


def invite_user(args: dict, user_id: str, organisation_admin: bool) -> dict:
    _require_board_role(args["boardId"], user_id, owner_only=True, organisation_admin=organisation_admin)
    response = boto3.client("cognito-idp").admin_create_user(
        UserPoolId=USER_POOL_ID,
        Username=args["email"],
        UserAttributes=[{"Name": "email", "Value": args["email"]}, {"Name": "email_verified", "Value": "true"}],
        DesiredDeliveryMediums=["EMAIL"],
    )
    invited_user_id = response["User"]["Username"]
    item = {"PK": f"BOARD#{args['boardId']}", "SK": f"MEMBER#{invited_user_id}", "entity": "MEMBER", "boardId": args["boardId"], "userId": invited_user_id, "role": "MODERATOR"}
    table.put_item(Item=item)
    return _public(item)


def handler(event: dict, _context: object) -> dict:
    field = event["info"]["fieldName"]
    args = event.get("arguments") or {}
    user_id, authenticated = _identity(event)
    claims = (event.get("identity") or {}).get("claims") or {}
    groups = claims.get("cognito:groups") or []
    if isinstance(groups, str):
        groups = [groups]
    organisation_admin = "Admins" in groups
    handlers = {
        "getBoard": lambda: get_board(args), "listQuestions": lambda: list_questions(args),
        "createBoard": lambda: create_board(args, user_id, authenticated),
        "createQuestion": lambda: create_question(args, user_id, authenticated),
        "castVote": lambda: cast_vote(args, user_id), "addComment": lambda: add_comment(args, user_id),
        "selectQuestion": lambda: select_question(args, user_id),
        "assignModerator": lambda: assign_moderator(args, user_id),
        "inviteUser": lambda: invite_user(args, user_id, organisation_admin),
    }
    if field not in handlers:
        raise ValueError(f"Unsupported field: {field}")
    return handlers[field]()
