// PhoneDeck macOS keyboard/mouse helper.
//
// Started once by the Electron main process. Reads one JSON command per line
// from stdin and writes one JSON response per line to stdout, using the same
// protocol as resources/keyboard-helper.ps1:
//
//   {"id":"1","steps":[{"kind":"keys","keys":["CTRL","C"],"holdMs":35}]}
//   {"id":"1","ok":true}
//
// Failures look like:
//   {"id":"1","ok":false,"error":"...","permission":"accessibility"}
//
// Input is injected with Quartz CGEvent at the HID event tap. Text is sent as
// Unicode so it is independent of the active keyboard layout. The helper needs
// Accessibility permission (System Settings -> Privacy & Security ->
// Accessibility); without it every input command returns a permission error
// instead of crashing. Permission is re-checked for every command, so granting
// it while PhoneDeck is running starts working immediately.
//
// Build with scripts/build-mac-helper.sh (arm64 by default, universal optional).

import Foundation
import AppKit
import ApplicationServices
import Darwin

struct HelperFailure: Error {
    let message: String
    let permission: String?

    init(_ message: String, permission: String? = nil) {
        self.message = message
        self.permission = permission
    }
}

let accessibilityPermission = "accessibility"
let accessibilityHelp = "Accessibility permission is required for PhoneDeck key and mouse actions. Open System Settings -> Privacy & Security -> Accessibility, enable PhoneDeck (add the helper if macOS lists it separately), then try again."

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          let text = String(data: data, encoding: .utf8),
          let line = (text + "\n").data(using: .utf8) else {
        return
    }
    FileHandle.standardOutput.write(line)
}

func intValue(_ value: Any?) -> Int? {
    if let number = value as? NSNumber {
        return number.intValue
    }
    if let string = value as? String {
        return Int(string)
    }
    return nil
}

func clampInt(_ value: Int, _ minimum: Int, _ maximum: Int) -> Int {
    return max(minimum, min(maximum, value))
}

// ANSI virtual keycodes (Events.h / Carbon HIToolbox). Keys are the canonical
// names produced by packages/shared/src/keys.ts. WIN maps to Command,
// ALT to Option and CTRL to Control.
let keyCodes: [String: UInt16] = [
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
    "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
    "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
    "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35,
    "L": 37, "J": 38, "'": 39, "K": 40, ";": 41, "\\": 42, ",": 43,
    "/": 44, "N": 45, "M": 46, ".": 47, "`": 50,
    "+": 24, "*": 28,

    "CTRL": 59, "ALT": 58, "SHIFT": 56, "WIN": 55,
    "ENTER": 36, "TAB": 48, "ESC": 53, "SPACE": 49,
    "BACKSPACE": 51, "DELETE": 117, "INSERT": 114,
    "HOME": 115, "END": 119, "PGUP": 116, "PGDN": 121,
    "UP": 126, "DOWN": 125, "LEFT": 123, "RIGHT": 124,
    "CAPSLOCK": 57,

    "NUMPAD0": 82, "NUMPAD1": 83, "NUMPAD2": 84, "NUMPAD3": 85,
    "NUMPAD4": 86, "NUMPAD5": 87, "NUMPAD6": 88, "NUMPAD7": 89,
    "NUMPAD8": 91, "NUMPAD9": 92,

    "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96,
    "F6": 97, "F7": 98, "F8": 100, "F9": 101, "F10": 109,
    "F11": 103, "F12": 111, "F13": 105, "F14": 107, "F15": 113,
    "F16": 106, "F17": 64, "F18": 79, "F19": 80, "F20": 90,
]

// Keys that exist in the Windows VK table but have no reliable macOS
// equivalent. Return a useful error instead of silently sending a wrong key.
let unsupportedKeys: [String: String] = [
    "PRINTSCREEN": "Print Screen is not available on macOS. Record a macOS screenshot shortcut instead.",
    "NUMLOCK": "Num Lock is not available on macOS.",
    "SCROLLLOCK": "Scroll Lock is not available on macOS.",
    "PAUSE": "Pause is not available on macOS.",
    "MENU": "The context-menu key is not available on macOS. Use SHIFT+F10 instead.",
]

func keyCode(for key: String) throws -> UInt16 {
    let upper = key.uppercased()
    if let message = unsupportedKeys[upper] {
        throw HelperFailure(message)
    }
    if let code = keyCodes[upper] ?? keyCodes[key] {
        return code
    }
    if upper.hasPrefix("F"), let number = Int(upper.dropFirst()), number >= 1, number <= 24 {
        throw HelperFailure("\(upper) is not available on macOS.")
    }
    throw HelperFailure("Key \(key) is not supported on macOS.")
}

final class KeyboardHelper {
    private let source = CGEventSource(stateID: .hidSystemState)
    private var held: Set<String> = []
    private var heldOrder: [String] = []

    func requireAccessibility() throws {
        if !AXIsProcessTrusted() {
            throw HelperFailure(accessibilityHelp, permission: accessibilityPermission)
        }
    }

    func invoke(_ step: [String: Any]) throws {
        guard let kind = step["kind"] as? String else {
            throw HelperFailure("Command step has no kind")
        }

        switch kind {
        case "keys":
            try sendKeys(step)
        case "text":
            try sendText(step)
        case "delay":
            let milliseconds = clampInt(intValue(step["ms"]) ?? 0, 0, 60_000)
            if milliseconds > 0 {
                Thread.sleep(forTimeInterval: Double(milliseconds) / 1000.0)
            }
        case "media":
            try sendMedia(step)
        case "mouse":
            try sendMouse(step)
        default:
            throw HelperFailure("Unknown step kind: \(kind)")
        }
    }

    func releaseHeldKeys() {
        for key in Array(heldOrder.reversed()) {
            _ = try? keyUp(key)
        }
    }

    // MARK: - Keyboard

    private func sendKeys(_ step: [String: Any]) throws {
        try requireAccessibility()

        guard let rawKeys = step["keys"] as? [String], !rawKeys.isEmpty else {
            throw HelperFailure("Key step needs at least one key")
        }

        let action = (step["action"] as? String ?? "press").lowercased()
        switch action {
        case "down":
            for key in rawKeys {
                try keyDown(key)
            }
        case "up":
            for key in rawKeys.reversed() {
                if held.contains(key) {
                    try keyUp(key)
                } else {
                    // Still post the release: it clears a stuck key after a
                    // helper restart and is harmless when the key is not held.
                    try postKey(key, down: false, flags: currentFlags())
                }
            }
        case "press":
            let holdMs = clampInt(intValue(step["holdMs"]) ?? 35, 0, 5_000)
            var pressed: [String] = []
            do {
                for key in rawKeys where !held.contains(key) {
                    try keyDown(key)
                    pressed.append(key)
                }
                if holdMs > 0 {
                    Thread.sleep(forTimeInterval: Double(holdMs) / 1000.0)
                }
            } catch {
                for key in pressed.reversed() {
                    _ = try? keyUp(key)
                }
                throw error
            }
            for key in pressed.reversed() {
                try keyUp(key)
            }
        default:
            throw HelperFailure("Unknown key action: \(action)")
        }
    }

    private func keyDown(_ key: String) throws {
        guard !held.contains(key) else {
            return
        }
        _ = try keyCode(for: key)
        held.insert(key)
        heldOrder.append(key)
        try postKey(key, down: true, flags: currentFlags())
    }

    private func keyUp(_ key: String) throws {
        _ = try keyCode(for: key)
        held.remove(key)
        heldOrder.removeAll { $0 == key }
        try postKey(key, down: false, flags: currentFlags())
    }

    private func postKey(_ key: String, down: Bool, flags: CGEventFlags) throws {
        let code = try keyCode(for: key)
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else {
            throw HelperFailure("Could not create a keyboard event for \(key)")
        }
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }

    private func currentFlags() -> CGEventFlags {
        var flags: CGEventFlags = []
        if held.contains("WIN") {
            flags.insert(.maskCommand)
        }
        if held.contains("ALT") {
            flags.insert(.maskAlternate)
        }
        if held.contains("CTRL") {
            flags.insert(.maskControl)
        }
        if held.contains("SHIFT") || held.contains("+") || held.contains("*") {
            flags.insert(.maskShift)
        }
        return flags
    }

    private func sendText(_ step: [String: Any]) throws {
        try requireAccessibility()

        guard let text = step["text"] as? String else {
            throw HelperFailure("Text step has no text")
        }
        let perCharMs = clampInt(intValue(step["perCharMs"]) ?? 4, 0, 1_000)

        for character in text {
            if character == "\r" {
                continue
            }
            if character == "\n" {
                try tapKey("ENTER")
            } else if character == "\t" {
                try tapKey("TAB")
            } else {
                try sendUnicode(String(character))
            }
            if perCharMs > 0 {
                Thread.sleep(forTimeInterval: Double(perCharMs) / 1000.0)
            }
        }
    }

    private func tapKey(_ key: String) throws {
        try keyDown(key)
        try keyUp(key)
    }

    private func sendUnicode(_ text: String) throws {
        let units = Array(text.utf16)
        guard !units.isEmpty else {
            return
        }

        // CGEventKeyboardSetUnicodeString accepts at most 20 UTF-16 units per
        // event. Split longer graphemes without cutting a surrogate pair.
        var offset = 0
        while offset < units.count {
            var end = min(offset + 20, units.count)
            if end < units.count, units[end - 1] >= 0xD800, units[end - 1] <= 0xDBFF {
                end -= 1
            }
            if end <= offset {
                end = min(offset + 20, units.count)
            }
            var chunk = Array(units[offset..<end])
            try postUnicode(units: &chunk, down: true)
            try postUnicode(units: &chunk, down: false)
            offset = end
        }
    }

    private func postUnicode(units: inout [UInt16], down: Bool) throws {
        guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else {
            throw HelperFailure("Could not create a Unicode keyboard event")
        }
        event.flags = currentFlags()
        units.withUnsafeBufferPointer { buffer in
            if let base = buffer.baseAddress {
                event.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: base)
            }
        }
        event.post(tap: .cghidEventTap)
    }

    // MARK: - Media

    private func sendMedia(_ step: [String: Any]) throws {
        try requireAccessibility()

        let key = (step["key"] as? String ?? "").lowercased()
        let keyType: Int32
        switch key {
        case "playpause": keyType = 16
        case "next": keyType = 17
        case "prev": keyType = 18
        case "volumeup": keyType = 0
        case "volumedown": keyType = 1
        case "mute": keyType = 7
        case "stop":
            throw HelperFailure("The media stop key is not available on macOS. Use play/pause instead.")
        default:
            throw HelperFailure("Unknown media key: \(key)")
        }

        try postMediaKey(keyType, down: true)
        Thread.sleep(forTimeInterval: 0.03)
        try postMediaKey(keyType, down: false)
    }

    private func postMediaKey(_ keyType: Int32, down: Bool) throws {
        // NX_KEYDOWN = 0xa, NX_KEYUP = 0xb. Subtype 8 is the auxiliary-control
        // (media) event used by NSEvent.systemDefined.
        let state: Int32 = down ? 0xa : 0xb
        let data1 = Int((keyType << 16) | (state << 8))
        guard let event = NSEvent.otherEvent(
            with: .systemDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: 0,
            context: nil,
            subtype: 8,
            data1: data1,
            data2: -1
        ) else {
            throw HelperFailure("Could not create a media key event")
        }
        if let cgEvent = event.cgEvent {
            cgEvent.post(tap: .cghidEventTap)
        }
    }

    // MARK: - Mouse

    private func sendMouse(_ step: [String: Any]) throws {
        try requireAccessibility()

        let action = (step["action"] as? String ?? "").lowercased()
        let button = mouseButton(step["button"] as? String ?? "left")
        let point = mousePoint(step)

        switch action {
        case "move":
            try postMouse(.mouseMoved, at: point, button: button, clickState: 0)
        case "scroll":
            try scroll(step)
        case "click":
            try click(at: point, button: button, double: false)
        case "doubleclick":
            try click(at: point, button: button, double: true)
        case "down":
            try postMouse(downType(for: button), at: point, button: button, clickState: 1)
        case "up":
            try postMouse(upType(for: button), at: point, button: button, clickState: 1)
        default:
            throw HelperFailure("Unknown mouse action: \(action)")
        }
    }

    private func mousePoint(_ step: [String: Any]) -> CGPoint {
        if let x = intValue(step["x"]), let y = intValue(step["y"]) {
            return CGPoint(x: x, y: y)
        }
        return CGEvent(source: nil)?.location ?? .zero
    }

    private func mouseButton(_ name: String) -> CGMouseButton {
        switch name.lowercased() {
        case "right":
            return .right
        case "middle":
            return .center
        default:
            return .left
        }
    }

    private func downType(for button: CGMouseButton) -> CGEventType {
        if button == .left {
            return .leftMouseDown
        }
        if button == .right {
            return .rightMouseDown
        }
        return .otherMouseDown
    }

    private func upType(for button: CGMouseButton) -> CGEventType {
        if button == .left {
            return .leftMouseUp
        }
        if button == .right {
            return .rightMouseUp
        }
        return .otherMouseUp
    }

    private func click(at point: CGPoint, button: CGMouseButton, double: Bool) throws {
        try postMouse(downType(for: button), at: point, button: button, clickState: 1)
        Thread.sleep(forTimeInterval: 0.02)
        try postMouse(upType(for: button), at: point, button: button, clickState: 1)

        if double {
            Thread.sleep(forTimeInterval: 0.05)
            try postMouse(downType(for: button), at: point, button: button, clickState: 2)
            Thread.sleep(forTimeInterval: 0.02)
            try postMouse(upType(for: button), at: point, button: button, clickState: 2)
        }
    }

    private func postMouse(
        _ type: CGEventType,
        at point: CGPoint,
        button: CGMouseButton,
        clickState: Int
    ) throws {
        guard let event = CGEvent(
            mouseEventSource: source,
            mouseType: type,
            mouseCursorPosition: point,
            mouseButton: button
        ) else {
            throw HelperFailure("Could not create a mouse event")
        }
        if clickState > 0 {
            event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        }
        event.post(tap: .cghidEventTap)
    }

    private func scroll(_ step: [String: Any]) throws {
        let amount = clampInt(intValue(step["amount"]) ?? 1, 1, 100)
        let direction = (step["direction"] as? String ?? "down").lowercased()
        var wheel1: Int32 = 0
        var wheel2: Int32 = 0

        switch direction {
        case "up":
            wheel1 = Int32(amount)
        case "down":
            wheel1 = -Int32(amount)
        case "right":
            wheel2 = Int32(amount)
        case "left":
            wheel2 = -Int32(amount)
        default:
            throw HelperFailure("Unknown scroll direction: \(direction)")
        }

        guard let event = CGEvent(
            scrollWheelEvent2Source: source,
            units: .line,
            wheelCount: 2,
            wheel1: wheel1,
            wheel2: wheel2,
            wheel3: 0
        ) else {
            throw HelperFailure("Could not create a scroll event")
        }
        event.post(tap: .cghidEventTap)
    }
}

// MARK: - Entry point

func runSelfTest() -> Bool {
    let required = [
        "A", "Z", "0", "9", "CTRL", "ALT", "SHIFT", "WIN",
        "ENTER", "TAB", "ESC", "SPACE", "BACKSPACE", "DELETE", "INSERT",
        "HOME", "END", "PGUP", "PGDN", "UP", "DOWN", "LEFT", "RIGHT",
        "CAPSLOCK", "NUMPAD0", "NUMPAD9", "F1", "F20",
        ";", "=", ",", "-", ".", "/", "\\", "`", "[", "]", "'", "+", "*",
    ]
    var missing: [String] = []
    for key in required where keyCodes[key] == nil {
        missing.append(key)
    }
    if !missing.isEmpty {
        emit(["selfTest": false, "error": "Missing key codes: \(missing.joined(separator: ", "))"])
        return false
    }
    emit(["selfTest": true, "keys": keyCodes.count, "platform": "macOS"])
    return true
}

if CommandLine.arguments.contains("--self-test") {
    exit(runSelfTest() ? 0 : 1)
}

if CommandLine.arguments.contains("--check") {
    let trusted = AXIsProcessTrusted()
    emit(["accessibility": trusted, "trusted": trusted])
    exit(0)
}

let helper = KeyboardHelper()
emit(["ready": true, "accessibility": AXIsProcessTrusted()])

while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        continue
    }

    var id = ""
    do {
        guard let data = trimmed.data(using: .utf8) else {
            throw HelperFailure("Command is not valid UTF-8")
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw HelperFailure("Command must be a JSON object")
        }
        id = object["id"] as? String ?? ""
        let steps = object["steps"] as? [[String: Any]] ?? []
        for step in steps {
            try helper.invoke(step)
        }
        emit(["id": id, "ok": true])
    } catch let failure as HelperFailure {
        var response: [String: Any] = ["id": id, "ok": false, "error": failure.message]
        if let permission = failure.permission {
            response["permission"] = permission
        }
        emit(response)
    } catch {
        emit(["id": id, "ok": false, "error": error.localizedDescription])
    }
}

helper.releaseHeldKeys()
