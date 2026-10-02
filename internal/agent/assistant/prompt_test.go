package assistant

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/amigoer/mq-studio/internal/model"
)

type browsed struct {
	Messages []model.MessageItem `json:"messages"`
}

// A body leaves the machine only as far as the person's setting goes, however
// deep in an answer it sits; everything else about the message goes as it is.
func TestABodyGoesOnlyAsFarAsTheSettingSays(t *testing.T) {
	answer := browsed{Messages: []model.MessageItem{{MessageID: "m1", Body: "card 4111 1111 1111 1111", Keys: "order-7"}}}

	withheld := forModel(answer, 0)
	if strings.Contains(withheld, "4111") || !strings.Contains(withheld, "withheld: 24 bytes") ||
		!strings.Contains(withheld, "order-7") {
		t.Errorf("with bodies off the model read %s", withheld)
	}
	cut := forModel(answer, 4)
	if !strings.Contains(cut, `"body":"card[cut: 4 of 24 bytes]"`) {
		t.Errorf("with 4 bytes the model read %s", cut)
	}
	if whole := forModel(answer, 2048); !strings.Contains(whole, "4111 1111 1111 1111") {
		t.Errorf("with 2 KB the model read %s", whole)
	}
}

func TestAnAnswerTooLongIsCutForTheModelAndStaysJSONForTheWindow(t *testing.T) {
	answer := browsed{}
	for range 2000 {
		answer.Messages = append(answer.Messages, model.MessageItem{MessageID: strings.Repeat("中", 50)})
	}

	cut := forModel(answer, 0)
	if len(cut) > maxResult+200 || !strings.Contains(cut, "[cut: the answer was") || !utf8.ValidString(cut) {
		t.Errorf("the model was handed %d bytes ending %q", len(cut), cut[len(cut)-120:])
	}
	shown := forWindow(answer)
	var text string
	if len(shown) > maxShown+16 || json.Unmarshal(shown, &text) != nil {
		t.Errorf("the window was handed %d bytes that are not one JSON string", len(shown))
	}
}

func TestATitleIsTheFirstQuestionOnOneLine(t *testing.T) {
	if got := titleOf("  Why is\n legacy-sync   behind? "); got != "Why is legacy-sync behind?" {
		t.Errorf("got %q", got)
	}
	long := strings.Repeat("为什么", 20)
	if got := titleOf(long); utf8.RuneCountInString(got) != 41 || !strings.HasSuffix(got, "…") {
		t.Errorf("got %q", got)
	}
}
