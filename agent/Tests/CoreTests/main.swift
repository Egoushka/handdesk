import Foundation
import HandDeskCore

run(MessageTests.init, [
    ("testDecodesEveryMessage", MessageTests.testDecodesEveryMessage),
    ("testRejectsMalformed", MessageTests.testRejectsMalformed),
    ("testModifierFlagBits", MessageTests.testModifierFlagBits),
])
run(EventMapperTests.init, [
    ("testGeometryClampsAndOffsets", EventMapperTests.testGeometryClampsAndOffsets),
    ("testMoveUsesDisplayOriginAndIgnoresUnknownDisplay", EventMapperTests.testMoveUsesDisplayOriginAndIgnoresUnknownDisplay),
    ("testClickDragSequence", EventMapperTests.testClickDragSequence),
    ("testDoubleClickCountsWithinWindowAndDistance", EventMapperTests.testDoubleClickCountsWithinWindowAndDistance),
    ("testRightButtonDoesNotDoubleWithLeft", EventMapperTests.testRightButtonDoesNotDoubleWithLeft),
    ("testScrollPixelsAndInvert", EventMapperTests.testScrollPixelsAndInvert),
    ("testMagnifyKeysStepAtAccumulatedThreshold", EventMapperTests.testMagnifyKeysStepAtAccumulatedThreshold),
    ("testMagnifyGestureModePassesDelta", EventMapperTests.testMagnifyGestureModePassesDelta),
    ("testSwipesMapToControlArrows", EventMapperTests.testSwipesMapToControlArrows),
    ("testKeyAndTextMapping", EventMapperTests.testKeyAndTextMapping),
    ("testLoneModifierPostsFlagsChangedAndStaysHeld", EventMapperTests.testLoneModifierPostsFlagsChangedAndStaysHeld),
    ("testSubscribeProducesNoPosterCalls", EventMapperTests.testSubscribeProducesNoPosterCalls),
])
run(KeyCodeTests.init, [
    ("testKnownCodes", KeyCodeTests.testKnownCodes),
    ("testTableHasNoDuplicateVirtualKeys", KeyCodeTests.testTableHasNoDuplicateVirtualKeys),
    ("testEveryLetterAndDigitIsMapped", KeyCodeTests.testEveryLetterAndDigitIsMapped),
])
run(TransportTests.init, [
    ("testHTTPParse", TransportTests.testHTTPParse),
    ("testHTTPIncompleteAndMalformed", TransportTests.testHTTPIncompleteAndMalformed),
    ("testResponseHasContentLength", TransportTests.testResponseHasContentLength),
    ("testStaticResolveRejectsTraversal", TransportTests.testStaticResolveRejectsTraversal),
    ("testTokenAndOrigin", TransportTests.testTokenAndOrigin),
    ("testAcceptKeyMatchesRFC6455Example", TransportTests.testAcceptKeyMatchesRFC6455Example),
    ("testHandshake", TransportTests.testHandshake),
    ("testMaskedFrameRoundTripAllLengthClasses", TransportTests.testMaskedFrameRoundTripAllLengthClasses),
    ("testParseIncompleteAndInvalid", TransportTests.testParseIncompleteAndInvalid),
    ("testControlFramesAndServerEncoding", TransportTests.testControlFramesAndServerEncoding),
])
run(VideoAndSupportTests.init, [
    ("testVideoHeader", VideoAndSupportTests.testVideoHeader),
    ("testAnnexBConversion", VideoAndSupportTests.testAnnexBConversion),
    ("testLaunchAgentPlist", VideoAndSupportTests.testLaunchAgentPlist),
    ("testTokenGenerateAndStore", VideoAndSupportTests.testTokenGenerateAndStore),
    ("testHelloMessage", VideoAndSupportTests.testHelloMessage),
])
run(HardeningTests.init, [
    ("testReleaseAllLetsGoOfButtonAndModifiers", HardeningTests.testReleaseAllLetsGoOfButtonAndModifiers),
    ("testMagnifyIsClampedAndCapped", HardeningTests.testMagnifyIsClampedAndCapped),
    ("testScrollIsClamped", HardeningTests.testScrollIsClamped),
    ("testDecodeRejectsOutOfRangeAndNonFinite", HardeningTests.testDecodeRejectsOutOfRangeAndNonFinite),
    ("testTextChunksKeepCharactersWhole", HardeningTests.testTextChunksKeepCharactersWhole),
    ("testLaunchAgentArgumentsCarryAbsoluteWebPath", HardeningTests.testLaunchAgentArgumentsCarryAbsoluteWebPath),
    ("testHostAllowlist", HardeningTests.testHostAllowlist),
    ("testSecurityHeaders", HardeningTests.testSecurityHeaders),
    ("testExistingTokenFileIsTightenedTo0600", HardeningTests.testExistingTokenFileIsTightenedTo0600),
])
print("\(testCount) tests, \(checkCount) checks, \(failureCount) failures")
exit(failureCount == 0 ? 0 : 1)
