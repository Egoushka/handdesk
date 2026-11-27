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
run(V2Tests.init, [
    ("testLoggerWritesJsonLinesAndHonoursLevel", V2Tests.testLoggerWritesJsonLinesAndHonoursLevel),
    ("testReconnectAndCloseReasons", V2Tests.testReconnectAndCloseReasons),
    ("testFieldsCannotOverrideReservedKeys", V2Tests.testFieldsCannotOverrideReservedKeys),
    ("testThrottledErrorsLogOncePerWindow", V2Tests.testThrottledErrorsLogOncePerWindow),
    ("testFileSinkRotatesAtMaxBytesKeepingOneOldFile", V2Tests.testFileSinkRotatesAtMaxBytesKeepingOneOldFile),
    ("testScrubRemovesTokensAndControlCharacters", V2Tests.testScrubRemovesTokensAndControlCharacters),
    ("testHelloCarriesVersion2AgentAndPermissions", V2Tests.testHelloCarriesVersion2AgentAndPermissions),
    ("testPingDecodesAndPongEchoes", V2Tests.testPingDecodesAndPongEchoes),
    ("testPageLogMessagesAreCleanedAndLimited", V2Tests.testPageLogMessagesAreCleanedAndLimited),
    ("testRateLimiterAllowsTwentyPerSecond", V2Tests.testRateLimiterAllowsTwentyPerSecond),
    ("testDebugFieldsNeverCarryKeysOrText", V2Tests.testDebugFieldsNeverCarryKeysOrText),
    ("testAdbDeviceParsingAndReverseDetection", V2Tests.testAdbDeviceParsingAndReverseDetection),
    ("testAdbArgumentBuilders", V2Tests.testAdbArgumentBuilders),
    ("testWifiAddressParsing", V2Tests.testWifiAddressParsing),
])
run(MacTests.init, [
    ("testSubscribeWithWindows", MacTests.testSubscribeWithWindows),
    ("testWindowAddressedInput", MacTests.testWindowAddressedInput),
    ("testVirtualDisplayDimAndLauncherMessages", MacTests.testVirtualDisplayDimAndLauncherMessages),
    ("testSpotlightQueryIsCleanedAndCapped", MacTests.testSpotlightQueryIsCleanedAndCapped),
    ("testDebugFieldsOmitTitlesAndQueries", MacTests.testDebugFieldsOmitTitlesAndQueries),
    ("testWindowFilter", MacTests.testWindowFilter),
    ("testWindowGeometryClampsInsideTheWindow", MacTests.testWindowGeometryClampsInsideTheWindow),
    ("testStreamIdsAllocateReuseAndExhaust", MacTests.testStreamIdsAllocateReuseAndExhaust),
    ("testWindowInputActivatesTheAppThenClicksInsideTheWindow", MacTests.testWindowInputActivatesTheAppThenClicksInsideTheWindow),
    ("testRightButtonOnAWindowAlsoFocusesAndUnknownWindowsAreIgnored", MacTests.testRightButtonOnAWindowAlsoFocusesAndUnknownWindowsAreIgnored),
    ("testWindowDoubleClickCountsLikeDisplayClicks", MacTests.testWindowDoubleClickCountsLikeDisplayClicks),
    ("testWindowsAndAppsReplies", MacTests.testWindowsAndAppsReplies),
    ("testAppActionsGoToTheSystem", MacTests.testAppActionsGoToTheSystem),
    ("testVirtualDisplayAddRemoveOnlyOwnDisplays", MacTests.testVirtualDisplayAddRemoveOnlyOwnDisplays),
    ("testVirtualDisplayUnavailableAndLimit", MacTests.testVirtualDisplayUnavailableAndLimit),
    ("testLastClientLeavingRemovesVirtualDisplaysAndRestoresBrightness", MacTests.testLastClientLeavingRemovesVirtualDisplaysAndRestoresBrightness),
    ("testSpotlightResultsAreOpenedByIdNeverByPath", MacTests.testSpotlightResultsAreOpenedByIdNeverByPath),
    ("testRaiseDecodesAndBringsOneWindowForward", MacTests.testRaiseDecodesAndBringsOneWindowForward),
    ("testWindowActivatorBeatsAppActivator", MacTests.testWindowActivatorBeatsAppActivator),
    ("testOtherMessagesAreNotHandled", MacTests.testOtherMessagesAreNotHandled),
    ("testMdfindArgumentsAreAnArrayAndEscaped", MacTests.testMdfindArgumentsAreAnArrayAndEscaped),
    ("testSpotlightRankAppsFirstDedupedAndCapped", MacTests.testSpotlightRankAppsFirstDedupedAndCapped),
    ("testOutgoingMessages", MacTests.testOutgoingMessages),
])
run(CertTests.init, [
    ("testConfigRoundTripAndDefaults", CertTests.testConfigRoundTripAndDefaults),
    ("testHostAndEmailValidation", CertTests.testHostAndEmailValidation),
    ("testDotenvValue", CertTests.testDotenvValue),
    ("testLegoEnvironmentCarriesNoToken", CertTests.testLegoEnvironmentCarriesNoToken),
    ("testP12UsesAPasswordFileNeverTheValue", CertTests.testP12UsesAPasswordFileNeverTheValue),
    ("testEnddateAndRenewalThreshold", CertTests.testEnddateAndRenewalThreshold),
    ("testDnsRecordIsPrivateDnsOnlyAndActionsAreIdempotent", CertTests.testDnsRecordIsPrivateDnsOnlyAndActionsAreIdempotent),
    ("testLanAddressPrefersEn0AndSkipsPublicAndVirtual", CertTests.testLanAddressPrefersEn0AndSkipsPublicAndVirtual),
    ("testRenewalPlistRunsCertRenewDaily", CertTests.testRenewalPlistRunsCertRenewDaily),
])
print("\(testCount) tests, \(checkCount) checks, \(failureCount) failures")
exit(failureCount == 0 ? 0 : 1)
