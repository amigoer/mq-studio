#ifndef ROCKET_LEAF_TRAFFICLIGHT_DARWIN_H
#define ROCKET_LEAF_TRAFFICLIGHT_DARWIN_H

// RLSetTrafficLightPosition moves the standard window buttons so the cluster
// starts `left` points from the window's left edge and its vertical centre sits
// `centreY` points below the window's top edge.
//
// Repeated calls on the same window update the target rather than stacking
// observers. Safe to call from any thread.
void RLSetTrafficLightPosition(void *nsWindow, double left, double centreY);

#endif
