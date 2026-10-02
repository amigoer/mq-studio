package mcpserver

// What the tools answer, as a client decodes it. The tools are defined in the
// toolset; these hold the fields the tests here read off the protocol, the
// way any client would, rather than borrowing the types that produced them.

type connectionsOutput struct {
	Connections []struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Family string `json:"family"`
		Status string `json:"status"`
		Allow  string `json:"allow"`
	} `json:"connections"`
}

type describeOutput struct {
	Family     string `json:"family"`
	Allow      string `json:"allow"`
	Operations []struct {
		ID    string `json:"id"`
		Blast string `json:"blast"`
		Tool  string `json:"tool"`
	} `json:"operations"`
}

type addEntryOutput struct {
	Effect struct {
		Changed string `json:"changed"`
	} `json:"effect"`
	IDs []string `json:"ids"`
}
