package pulsar

import (
	"context"
	"fmt"
)

// NodeConfig is what the broker is actually running with.
//
// The address is accepted and not used, and that is worth saying rather than
// hiding: Pulsar has no per-broker admin endpoint. Every call goes to the web
// service address this profile was configured with, and it answers for the
// broker that serves it. Behind a load balancer that is an arbitrary one, so
// the page is showing "a broker's" configuration, not "that broker's".
//
// Two sources, merged, because they answer different questions: the runtime
// values are everything the broker is running with, and the dynamic ones are
// the subset an administrator has overridden - which is the part worth acting
// on, and is invisible if only the merged result is shown.
func (c *Conn) NodeConfig(ctx context.Context, _ string) (map[string]string, error) {
	runtime, err := c.admin.Brokers().GetRuntimeConfigurationsWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("read the broker configuration: %w", err)
	}

	config := make(map[string]string, len(runtime))
	for key, value := range runtime {
		config[key] = value
	}
	// Overrides win, because they are what this cluster was actually told to
	// do. Best-effort: reading them needs a superuser on some clusters, and a
	// config page that fails entirely rather than omitting the overlay is
	// worse for the operator who could have read the rest.
	if dynamic, err := c.admin.Brokers().GetAllDynamicConfigurationsWithContext(ctx); err == nil {
		for key, value := range dynamic {
			config[key] = value
		}
	}
	return config, nil
}

// DirectoryConfig is the metadata store the cluster keeps its state in.
//
// It is the nearest thing Pulsar has to a discovery tier: brokers find each
// other through it, and an operator looking for "what is this cluster
// pointed at" is looking for these four addresses.
func (c *Conn) DirectoryConfig(ctx context.Context) (map[string]string, error) {
	internal, err := c.admin.Brokers().GetInternalConfigurationDataWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("read the internal configuration: %w", err)
	}
	if internal == nil {
		return map[string]string{}, nil
	}

	config := map[string]string{}
	putIf(config, "metadataStoreUrl", internal.ZookeeperServers)
	putIf(config, "configurationMetadataStoreUrl", internal.ConfigurationStoreServers)
	putIf(config, "ledgersRootPath", internal.LedgersRootPath)
	putIf(config, "stateStorageServiceUrl", internal.StateStorageServiceURL)
	return config, nil
}
