import Foundation

// The Mac's Command Line Tools ship neither XCTest nor the Swift Testing macros, so the tests run as a plain executable
// (`swift run core-tests`) that works with or without Xcode. Failures are counted and make the process exit 1.
nonisolated(unsafe) var checkCount = 0
nonisolated(unsafe) var failureCount = 0
nonisolated(unsafe) var testCount = 0

func fail(_ message: String, _ file: StaticString, _ line: UInt) {
    failureCount += 1
    print("FAIL \(file):\(line) \(message)")
}
func XCTAssertEqual<T: Equatable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, _ message: @autoclosure () -> String = "", file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    let x = try a(), y = try b()
    if x != y { fail("\(x) != \(y) \(message())", file, line) }
}
func XCTAssertNotEqual<T: Equatable>(_ a: @autoclosure () throws -> T, _ b: @autoclosure () throws -> T, file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    let x = try a(), y = try b()
    if x == y { fail("\(x) == \(y)", file, line) }
}
func XCTAssertTrue(_ v: @autoclosure () throws -> Bool, _ message: @autoclosure () -> String = "", file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    if !(try v()) { fail("expected true \(message())", file, line) }
}
func XCTAssertFalse(_ v: @autoclosure () throws -> Bool, file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    if try v() { fail("expected false", file, line) }
}
func XCTAssertNil<T>(_ v: @autoclosure () throws -> T?, file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    if let x = try v() { fail("expected nil, got \(x)", file, line) }
}
func XCTAssertNotNil<T>(_ v: @autoclosure () throws -> T?, _ message: @autoclosure () -> String = "", file: StaticString = #file, line: UInt = #line) rethrows {
    checkCount += 1
    if try v() == nil { fail("expected non-nil \(message())", file, line) }
}
func XCTFail(_ message: String = "", file: StaticString = #file, line: UInt = #line) {
    checkCount += 1
    fail(message, file, line)
}

func run<T>(_ make: () -> T, _ tests: [(String, (T) -> () throws -> Void)]) {
    for (name, fn) in tests {
        testCount += 1
        let before = failureCount
        do { try fn(make())() } catch { fail("\(name) threw \(error)", #file, #line) }
        if failureCount == before { print("ok   \(T.self).\(name)") }
    }
}
