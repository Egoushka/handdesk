import Foundation

public enum KeyCodes {
    /// DOM KeyboardEvent.code to macOS virtual key code (ANSI layout positions).
    public static let table: [String: UInt16] = [
        "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6, "KeyX": 7, "KeyC": 8, "KeyV": 9,
        "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14, "KeyR": 15, "KeyY": 16, "KeyT": 17,
        "Digit1": 18, "Digit2": 19, "Digit3": 20, "Digit4": 21, "Digit6": 22, "Digit5": 23, "Equal": 24,
        "Digit9": 25, "Digit7": 26, "Minus": 27, "Digit8": 28, "Digit0": 29, "BracketRight": 30,
        "KeyO": 31, "KeyU": 32, "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37,
        "KeyJ": 38, "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43, "Slash": 44,
        "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50, "Backspace": 51,
        "Escape": 53, "MetaRight": 54, "MetaLeft": 55, "ShiftLeft": 56, "CapsLock": 57, "AltLeft": 58,
        "ControlLeft": 59, "ShiftRight": 60, "AltRight": 61, "ControlRight": 62,
        "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101,
        "F10": 109, "F11": 103, "F12": 111,
        "Delete": 117, "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121,
        "ArrowLeft": 123, "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126,
    ]

    /// Lone modifier keys and the modifier each one toggles.
    public static let modifierKeys: [String: Modifiers] = [
        "MetaLeft": .cmd, "MetaRight": .cmd, "ControlLeft": .ctrl, "ControlRight": .ctrl,
        "AltLeft": .alt, "AltRight": .alt, "ShiftLeft": .shift, "ShiftRight": .shift,
    ]

    public static func virtualKey(for domCode: String) -> UInt16? { table[domCode] }
}
