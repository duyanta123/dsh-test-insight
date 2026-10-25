package math

import "testing"

func TestSum(t *testing.T) {
	if Sum([]int{1, 2}) != 3 {
		t.FailNow()
	}
}
