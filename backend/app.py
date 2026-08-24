"""AppSync Lambda resolver for Askboard's DynamoDB single-table backend."""

from __future__ import annotations

import os
import time
import uuid
import hashlib
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr, Key

TABLE_NAME = os.environ["TABLE_NAME"]
USER_POOL_ID = os.environ["USER_POOL_ID"]
table = boto3.resource("dynamodb").Table(TABLE_NAME)

PSEUDONYM_ADJECTIVES = (
    "Brave", "Bright", "Calm", "Clever", "Curious", "Friendly", "Gentle", "Helpful",
    "Honest", "Jolly", "Kind", "Lively", "Patient", "Quiet", "Thoughtful", "Wise",
)
PSEUDONYM_ANIMALS = (
    "Badger", "Dolphin", "Falcon", "Fox", "Heron", "Koala", "Otter", "Owl",
    "Panda", "Penguin", "Rabbit", "Robin", "Seal", "Tiger", "Turtle", "Wombat",
)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _pseudonym(participant_id: str) -> str:
    """Return a stable, friendly pseudonym without exposing the participant ID."""
    digest = hashlib.sha256(participant_id.encode("utf-8")).digest()
    adjective = PSEUDONYM_ADJECTIVES[int.from_bytes(digest[:2], "big") % len(PSEUDONYM_ADJECTIVES)]
    animal = PSEUDONYM_ANIMALS[int.from_bytes(digest[2:4], "big") % len(PSEUDONYM_ANIMALS)]
    return f"{adjective} {animal}"


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
    if result and not result.get("boardId"):
        result["boardId"] = result["id"]
        table.update_item(Key={"PK": result["PK"], "SK": result["SK"]}, UpdateExpression="SET boardId = :boardId", ExpressionAttributeValues={":boardId": result["id"]})
    if result and not result.get("categories"):
        result["categories"] = ["General"]
        table.update_item(Key={"PK": result["PK"], "SK": result["SK"]}, UpdateExpression="SET categories = :categories", ExpressionAttributeValues={":categories": result["categories"]})
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


def create_board(args: dict, user_id: str, authenticated: bool, organisation_admin: bool) -> dict:
    if not authenticated:
        raise PermissionError("Sign in to create a board")
    organization = get_organisation_settings()
    if not organisation_admin and not organization["membersCanCreateBoards"]:
        raise PermissionError("Only organization administrators can create boards")
    data = args["input"]
    board_id, now = str(uuid.uuid4()), _now()
    item = {
        "PK": f"BOARD#{board_id}", "SK": "META", "entity": "BOARD", "id": board_id, "boardId": board_id,
        "title": data["title"], "description": data.get("description"),
        "visibility": data.get("visibility") or organization["defaultVisibility"], "postingPolicy": data.get("postingPolicy", "ANYONE"),
        "votingMode": data.get("votingMode") or organization["defaultVotingMode"], "commentsEnabled": data.get("commentsEnabled", True),
        "visibleVoteTotals": True, "anonymousPosting": True, "categories": ["General"], "presentedQuestionId": None, "createdBy": user_id,
        "createdAt": now, "updatedAt": now,
    }
    table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    table.put_item(Item={**item, "PK": "ORG#DEFAULT", "SK": f"BOARD#{board_id}"})
    return _public(item)


def get_board(args: dict) -> dict:
    return _public(_get_board(args["id"]))


def update_board(args: dict, user_id: str, organisation_admin: bool) -> dict:
    data = args["input"]
    _get_board(data["id"])
    _require_board_role(data["id"], user_id, owner_only=True, organisation_admin=organisation_admin)
    allowed = {"title", "description", "visibility", "postingPolicy", "votingMode", "commentsEnabled", "visibleVoteTotals", "anonymousPosting", "categories"}
    changes = {key: value for key, value in data.items() if key in allowed and value is not None}
    if not changes:
        return _public(_get_board(data["id"]))
    names, values, assignments = {}, {}, []
    for index, (key, value) in enumerate(changes.items()):
        names[f"#field{index}"] = key
        values[f":value{index}"] = value
        assignments.append(f"#field{index} = :value{index}")
    names["#updatedAt"] = "updatedAt"
    values[":updatedAt"] = _now()
    assignments.append("#updatedAt = :updatedAt")
    result = table.update_item(
        Key={"PK": f"BOARD#{data['id']}", "SK": "META"},
        UpdateExpression="SET " + ", ".join(assignments), ExpressionAttributeNames=names,
        ExpressionAttributeValues=values, ReturnValues="ALL_NEW",
    )
    return _public(result["Attributes"])


def delete_board(args: dict, user_id: str, organisation_admin: bool) -> bool:
    board_id = args["id"]
    _require_board_role(board_id, user_id, owner_only=True, organisation_admin=organisation_admin)
    board_items = table.query(KeyConditionExpression=Key("PK").eq(f"BOARD#{board_id}")).get("Items", [])
    question_ids = [item["id"] for item in board_items if item.get("entity") == "QUESTION"]
    with table.batch_writer() as batch:
        for item in board_items:
            batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
        batch.delete_item(Key={"PK": "ORG#DEFAULT", "SK": f"BOARD#{board_id}"})
        for question_id in question_ids:
            votes = table.query(KeyConditionExpression=Key("PK").eq(f"QUESTION#{question_id}")).get("Items", [])
            for vote in votes:
                batch.delete_item(Key={"PK": vote["PK"], "SK": vote["SK"]})
    return True


def list_boards() -> list[dict]:
    # The organization is intentionally single-tenant. Scanning board metadata
    # also discovers boards created before the organization index was added.
    result = table.scan(FilterExpression=Attr("entity").eq("BOARD") & Attr("SK").eq("META"))
    return [_public(item) for item in result.get("Items", [])]


def get_organisation_settings() -> dict:
    item = table.get_item(Key={"PK": "ORG#DEFAULT", "SK": "SETTINGS"}).get("Item") or {
        "organizationName": "Anyhow Only", "defaultVisibility": "UNLISTED", "defaultVotingMode": "UP_DOWN",
        "membersCanCreateBoards": True,
    }
    return _public(item)


def update_organisation_settings(args: dict, organisation_admin: bool) -> dict:
    if not organisation_admin:
        raise PermissionError("Organization administrator access is required")
    data = args["input"]
    item = {"PK": "ORG#DEFAULT", "SK": "SETTINGS", "entity": "ORGANIZATION_SETTINGS", **data, "updatedAt": _now()}
    table.put_item(Item=item)
    return _public(item)


def get_my_settings(user_id: str) -> dict:
    item = table.get_item(Key={"PK": f"USER#{user_id}", "SK": "SETTINGS"}).get("Item") or {
        "userId": user_id, "defaultIdentity": "ASK",
    }
    return _public(item)


def update_my_settings(args: dict, user_id: str) -> dict:
    item = {"PK": f"USER#{user_id}", "SK": "SETTINGS", "entity": "USER_SETTINGS", "userId": user_id, **args["input"], "updatedAt": _now()}
    table.put_item(Item=item)
    return _public(item)


def create_question(args: dict, participant_id: str, authenticated: bool, organisation_admin: bool) -> dict:
    data, now = args["input"], _now()
    board = _get_board(data["boardId"])
    categories = board.get("categories") or ["General"]
    if data["category"] not in categories:
        raise ValueError("That category is not enabled for this board")
    if board["postingPolicy"] == "CLOSED":
        raise PermissionError("This board is not accepting questions")
    if board["postingPolicy"] == "AUTHENTICATED" and not authenticated:
        raise PermissionError("Sign in to post on this board")
    if board["postingPolicy"] == "MODERATORS":
        _require_board_role(data["boardId"], participant_id, organisation_admin=organisation_admin)
    if not board.get("anonymousPosting", True) and not data.get("identifyAs"):
        raise PermissionError("This board requires an identified display name")
    question_id = str(uuid.uuid4())
    pseudonym = data.get("identifyAs") or _pseudonym(participant_id)
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


def _migrate_legacy_pseudonyms(question: dict) -> dict:
    """Replace previously exposed Guest identifiers with friendly names."""
    changed = False
    if str(question.get("authorDisplayName", "")).startswith("Guest "):
        question["authorDisplayName"] = _pseudonym(f"question:{question['id']}")
        changed = True
    for comment in question.get("comments", []):
        if not comment.get("boardId"):
            comment["boardId"] = question["boardId"]
            changed = True
        if str(comment.get("authorDisplayName", "")).startswith("Guest "):
            comment["authorDisplayName"] = _pseudonym(f"comment:{comment['id']}")
            changed = True
    if changed:
        table.update_item(
            Key={"PK": question["PK"], "SK": question["SK"]},
            UpdateExpression="SET authorDisplayName = :author, comments = :comments",
            ExpressionAttributeValues={":author": question["authorDisplayName"], ":comments": question.get("comments", [])},
        )
    return question


def update_question(args: dict, user_id: str, organisation_admin: bool) -> dict:
    data = args["input"]
    _require_board_role(data["boardId"], user_id, organisation_admin=organisation_admin)
    question = _find_question(data["boardId"], data["questionId"])
    if data.get("category") and data["category"] not in (_get_board(data["boardId"]).get("categories") or ["General"]):
        raise ValueError("That category is not enabled for this board")
    changes = {key: value for key, value in data.items() if key in {"body", "category", "status"} and value is not None}
    if not changes:
        return _public(question)
    names, values, assignments = {}, {}, []
    for index, (key, value) in enumerate(changes.items()):
        names[f"#field{index}"] = key
        values[f":value{index}"] = value
        assignments.append(f"#field{index} = :value{index}")
    names["#updatedAt"] = "updatedAt"
    values[":updatedAt"] = _now()
    assignments.append("#updatedAt = :updatedAt")
    result = table.update_item(Key={"PK": question["PK"], "SK": question["SK"]}, UpdateExpression="SET " + ", ".join(assignments), ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues="ALL_NEW")
    return _public(result["Attributes"])


def delete_question(args: dict, user_id: str, organisation_admin: bool) -> dict:
    _require_board_role(args["boardId"], user_id, organisation_admin=organisation_admin)
    question = _find_question(args["boardId"], args["questionId"])
    table.delete_item(Key={"PK": question["PK"], "SK": question["SK"]})
    votes = table.query(KeyConditionExpression=Key("PK").eq(f"QUESTION#{args['questionId']}")).get("Items", [])
    with table.batch_writer() as batch:
        for vote in votes:
            batch.delete_item(Key={"PK": vote["PK"], "SK": vote["SK"]})
    return {**_public(question), "deleted": True, "updatedAt": _now()}


def reorder_questions(args: dict, user_id: str, organisation_admin: bool) -> list[dict]:
    _require_board_role(args["boardId"], user_id, organisation_admin=organisation_admin)
    questions = {_public(item)["id"]: item for item in table.query(KeyConditionExpression=Key("PK").eq(f"BOARD#{args['boardId']}") & Key("SK").begins_with("QUESTION#")).get("Items", [])}
    if len(args["questionIds"]) != len(questions) or set(args["questionIds"]) != set(questions):
        raise ValueError("The reordered list must contain every question exactly once")
    ordered = []
    for index, question_id in enumerate(args["questionIds"]):
        item = questions[question_id]
        rank = f"{index:08d}"
        table.update_item(Key={"PK": item["PK"], "SK": item["SK"]}, UpdateExpression="SET #rank = :rank, updatedAt = :now", ExpressionAttributeNames={"#rank": "rank"}, ExpressionAttributeValues={":rank": rank, ":now": _now()})
        item["rank"] = rank
        ordered.append(_public(item))
    return ordered


def list_questions(args: dict) -> dict:
    board_id, limit = args["boardId"], min(args.get("limit") or 100, 100)
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"BOARD#{board_id}") & Key("SK").begins_with("QUESTION#"),
        Limit=limit, ScanIndexForward=False,
    )
    items = [_public(_migrate_legacy_pseudonyms(item)) for item in result.get("Items", [])]
    return {"items": sorted(items, key=lambda item: item.get("rank", item["createdAt"])), "nextToken": None}


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
    comment = {"id": str(uuid.uuid4()), "boardId": data["boardId"], "questionId": data["questionId"], "body": data["body"], "authorDisplayName": _pseudonym(participant_id), "createdAt": now}
    table.update_item(Key={"PK": question["PK"], "SK": question["SK"]}, UpdateExpression="SET comments = list_append(if_not_exists(comments, :empty), :comment), updatedAt = :now", ExpressionAttributeValues={":empty": [], ":comment": [comment], ":now": now})
    return comment


def select_question(args: dict, user_id: str, organisation_admin: bool) -> dict:
    _get_board(args["boardId"])
    _require_board_role(args["boardId"], user_id, organisation_admin=organisation_admin)
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
        "getBoard": lambda: get_board(args), "listBoards": list_boards, "listQuestions": lambda: list_questions(args),
        "getOrganizationSettings": get_organisation_settings, "getMySettings": lambda: get_my_settings(user_id),
        "createBoard": lambda: create_board(args, user_id, authenticated, organisation_admin),
        "updateBoard": lambda: update_board(args, user_id, organisation_admin),
        "deleteBoard": lambda: delete_board(args, user_id, organisation_admin),
        "createQuestion": lambda: create_question(args, user_id, authenticated, organisation_admin),
        "castVote": lambda: cast_vote(args, user_id), "addComment": lambda: add_comment(args, user_id),
        "updateQuestion": lambda: update_question(args, user_id, organisation_admin),
        "deleteQuestion": lambda: delete_question(args, user_id, organisation_admin),
        "reorderQuestions": lambda: reorder_questions(args, user_id, organisation_admin),
        "selectQuestion": lambda: select_question(args, user_id, organisation_admin),
        "assignModerator": lambda: assign_moderator(args, user_id),
        "inviteUser": lambda: invite_user(args, user_id, organisation_admin),
        "updateOrganizationSettings": lambda: update_organisation_settings(args, organisation_admin),
        "updateMySettings": lambda: update_my_settings(args, user_id),
    }
    if field not in handlers:
        raise ValueError(f"Unsupported field: {field}")
    return handlers[field]()
