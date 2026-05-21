package sample

import (
	"fmt"
	alias "strings"
)

type Widget struct{}

func Render(w Widget) string {
	helper()
	w.Draw()
	fmt.Println(alias.TrimSpace(" rendering "))
	return "ok"
}

func (w Widget) Draw() {}

func helper() {}
