#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#import "trafficlight_darwin.h"

// Wails has no equivalent of Electron's trafficLightPosition, so the standard
// window buttons are moved by hand to line up with the renderer's title bar.
//
// AppKit re-lays the buttons out whenever the themed frame is rebuilt - on live
// resize and when leaving fullscreen - so the offset cannot be applied once. A
// positioner is attached to the window, remembers the target, and re-applies it
// on those notifications.

static const void *kPositionerKey = &kPositionerKey;

@interface RLTrafficLightPositioner : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic) CGFloat left;
@property(nonatomic) CGFloat centreY;
- (void)apply;
@end

@implementation RLTrafficLightPositioner

- (instancetype)initWithWindow:(NSWindow *)window {
  self = [super init];
  if (self) {
    _window = window;
    NSNotificationCenter *centre = [NSNotificationCenter defaultCenter];
    for (NSNotificationName name in @[
           NSWindowDidResizeNotification,
           NSWindowDidExitFullScreenNotification,
           NSWindowDidBecomeKeyNotification,
         ]) {
      [centre addObserver:self
                 selector:@selector(reapply:)
                     name:name
                   object:window];
    }
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)reapply:(NSNotification *)notification {
  [self apply];
}

- (void)apply {
  NSWindow *window = self.window;
  if (window == nil) {
    return;
  }
  // In fullscreen AppKit owns the buttons inside the menu bar overlay; moving
  // them there would misplace them.
  if ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) {
    return;
  }

  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *miniaturise = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (close == nil || miniaturise == nil || zoom == nil) {
    return;
  }
  NSView *container = close.superview;
  if (container == nil) {
    return;
  }

  // Keep whatever spacing AppKit chose; only move the cluster as a whole.
  CGFloat spacing = NSMinX(miniaturise.frame) - NSMinX(close.frame);
  if (spacing <= 0) {
    spacing = NSWidth(close.frame) + 6.0;
  }

  // The container is unflipped and its top edge meets the window's top edge, so
  // a distance measured from the window top counts down from the container top.
  CGFloat height = NSHeight(close.frame);
  CGFloat originY = NSHeight(container.frame) - self.centreY - height / 2.0;

  NSButton *buttons[3] = {close, miniaturise, zoom};
  for (int index = 0; index < 3; index++) {
    NSRect frame = buttons[index].frame;
    frame.origin.x = self.left + spacing * index;
    frame.origin.y = originY;
    buttons[index].frame = frame;
  }
}

@end

void RLSetTrafficLightPosition(void *nsWindow, double left, double centreY) {
  if (nsWindow == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)nsWindow;

  void (^work)(void) = ^{
    RLTrafficLightPositioner *positioner =
        objc_getAssociatedObject(window, kPositionerKey);
    if (positioner == nil) {
      positioner = [[RLTrafficLightPositioner alloc] initWithWindow:window];
      objc_setAssociatedObject(window, kPositionerKey, positioner,
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    positioner.left = (CGFloat)left;
    positioner.centreY = (CGFloat)centreY;
    [positioner apply];
  };

  if ([NSThread isMainThread]) {
    work();
  } else {
    dispatch_async(dispatch_get_main_queue(), work);
  }
}
