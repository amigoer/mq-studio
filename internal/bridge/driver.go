package bridge

import (
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// DriverService tells the frontend which broker families exist, what their
// connection forms look like, and what a live connection can actually do.
//
// It is what the renderer boots from: the navigation, the connection form and
// every gated control are derived from these three answers rather than
// hardcoded for one family.
type DriverService struct {
	conns func(connID int) (driver.Conn, error)
}

// DriverInfo is one registered family.
type DriverInfo struct {
	Kind        model.MQKind `json:"kind"`
	DefaultPort string       `json:"defaultPort"`
}

// List returns every family a driver is compiled in for.
func (s *DriverService) List() []DriverInfo {
	kinds := driver.Registered()
	infos := make([]DriverInfo, 0, len(kinds))
	for _, kind := range kinds {
		found, ok := driver.Lookup(kind)
		if !ok {
			continue
		}
		infos = append(infos, DriverInfo{Kind: kind, DefaultPort: found.Descriptor().DefaultPort})
	}
	return infos
}

// Descriptor returns a family's connection form and best-case capabilities.
// It answers without a connection, because the form is drawn before anything
// is dialled.
func (s *DriverService) Descriptor(kind model.MQKind) (*model.DriverDescriptor, error) {
	found, ok := driver.Lookup(kind)
	if !ok {
		return nil, driver.ErrUnknownKind
	}
	descriptor := found.Descriptor()
	return &descriptor, nil
}

// Capabilities returns what one live connection can do.
//
// An unopened connection reports nothing supported rather than an error: the
// renderer asks on every page load, including before anything is connected,
// and an error there would be noise rather than information.
func (s *DriverService) Capabilities(connID int) (*model.Capabilities, error) {
	conn, err := s.conns(connID)
	if err != nil {
		empty := model.NewCapabilities()
		return &empty, nil
	}
	capabilities := conn.Capabilities()
	return &capabilities, nil
}
