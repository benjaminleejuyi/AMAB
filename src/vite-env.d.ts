/// <reference types="vite/client" />

// Keep stylesheet imports type-safe even when TypeScript is invoked before
// Vite has augmented the project's module declarations.
declare module '*.css'
