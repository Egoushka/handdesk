#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include "CVD.h"

// CGVirtualDisplay is private API (it is what Meta's and other virtual display apps use). The interfaces are declared here only so
// messages type-check; the classes are looked up by name at run time, so nothing links against private symbols.
@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(double)refreshRate;
@end
@interface CGVirtualDisplaySettings : NSObject
@property(nonatomic) unsigned int hiDPI;
@property(retain, nonatomic) NSArray *modes;
@end
@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) dispatch_queue_t queue;
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsHigh;
@property(nonatomic) unsigned int maxPixelsWide;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int productID;
@property(nonatomic) unsigned int vendorID;
@property(nonatomic) unsigned int serialNum;
@end
@interface CGVirtualDisplay : NSObject
@property(readonly, nonatomic) unsigned int displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

static NSMutableDictionary<NSNumber *, id> *displays(void) {
    static NSMutableDictionary *d;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ d = [NSMutableDictionary new]; });
    return d;
}

static void put_err(char *err, size_t len, NSString *msg) {
    if (err && len) { strlcpy(err, msg.UTF8String, len); }
}

bool cvd_available(void) {
    return NSClassFromString(@"CGVirtualDisplay") && NSClassFromString(@"CGVirtualDisplayDescriptor")
        && NSClassFromString(@"CGVirtualDisplaySettings") && NSClassFromString(@"CGVirtualDisplayMode");
}

uint32_t cvd_create(const char *name, uint32_t width, uint32_t height, char *err, size_t err_len) {
    @autoreleasepool {
        if (!cvd_available()) { put_err(err, err_len, @"unavailable: CGVirtualDisplay classes not found on this macOS"); return 0; }
        CGVirtualDisplayDescriptor *desc = [[NSClassFromString(@"CGVirtualDisplayDescriptor") alloc] init];
        desc.queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
        desc.name = [NSString stringWithUTF8String:name ? name : "handdesk"];
        desc.maxPixelsWide = width;
        desc.maxPixelsHigh = height;
        desc.sizeInMillimeters = CGSizeMake(width * 25.4 / 110.0, height * 25.4 / 110.0); // about 110 pixels per inch
        desc.vendorID = 0x4844; // "HD"
        desc.productID = 0x0001;
        desc.serialNum = (unsigned int)arc4random();
        CGVirtualDisplay *display = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:desc];
        if (!display) { put_err(err, err_len, @"unavailable: the system refused to create a virtual display"); return 0; }
        CGVirtualDisplaySettings *settings = [[NSClassFromString(@"CGVirtualDisplaySettings") alloc] init];
        settings.hiDPI = 0;
        CGVirtualDisplayMode *mode = [[NSClassFromString(@"CGVirtualDisplayMode") alloc] initWithWidth:width height:height refreshRate:60];
        settings.modes = @[mode];
        if (![display applySettings:settings]) { put_err(err, err_len, @"unavailable: the display did not accept its settings"); return 0; }
        uint32_t did = display.displayID;
        if (did == 0) { put_err(err, err_len, @"unavailable: the display got no id"); return 0; }
        displays()[@(did)] = display;
        return did;
    }
}

bool cvd_remove(uint32_t display_id) {
    @autoreleasepool {
        id d = displays()[@(display_id)];
        if (!d) return false;
        [displays() removeObjectForKey:@(display_id)]; // releasing the object destroys the display
        return true;
    }
}
