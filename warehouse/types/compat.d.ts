// Compatibility shim for TypeScript/lib type differences
// Some @types/node / lib combinations reference `NonSharedArrayBufferView` which
// may not exist in the active TypeScript lib set used by VS Code. This file
// provides a minimal alias to keep the project compiling in editors.

type NonSharedArrayBufferView = ArrayBufferView;

export {};
