package auth

import "testing"

func TestVerify(t *testing.T) {
	if !Verify("ok") {
		t.FailNow()
	}
}
