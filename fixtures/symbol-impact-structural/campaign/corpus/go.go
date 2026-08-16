package campaign

type ExportedGoType struct {
    Value int
}

func ExportedGoFunction() int { return 1 }

var internalGoVariable = 1

type internalGoType struct{}

func (internalGoType) internalGoMethod() int { return 1 }
