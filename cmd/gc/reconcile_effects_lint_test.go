package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// The effects' write lint (CONTRACT v5 R3, I24): effect and step files reach
// the store only through fencedWriter, and start no runtime through
// legacy's start path. C4c2 and C6a extend it to the identity env keys and
// the stop-request keys.

// effectBannedMethods are the blind writers. Any selector naming one is
// banned, a method value included:
//   - the unconditional session.Store methods;
//   - the session.Store verbs that fall back to a blind write when no
//     conditional writer resolves (fencedWriter wraps the safe ones);
//   - the plain beads.Store mutators;
//   - the start-commit whose premise admits state=asleep (v5 S2);
//   - the runtime stops that skip the destructive fence (v5 O2).
var effectBannedMethods = []string{
	"ApplyPatch", "ApplyPatchInfo", "UpdateMetadataInfo", "SetMetadata", "SetMetadataBatch", "SetMarker", "SetState",
	"Sleep", "BeginDrainAckStopPending", "RequestRestart", "ResetConfigDrift", "SetWaitHold", "RecordCurrentBead",
	"SetCurrentClaim", "SetStatusOpen", "RepairType", "RepairTypeBestEffort", "SetLocalString", "CloseWithoutReason",
	"UpdateMetadataFenced", "ApplyPatchIfLifecycleUnchanged", "WithPendingCreateRollback", "CloseWithTerminalPatch",
	"RollbackPendingCreateAtomically",
	"Create", "Update", "Close", "Reopen", "CloseAll", "Delete", "Tx", "DepAdd", "DepRemove",
	"CommitStartedIfCurrent",
	"StopUnattendedSession", "StopForCleanup",
	"NewStore", // session.NewStore: the raw session front door
}

// effectBannedFuncs are package functions: the raw session front door, and
// legacy's start path (D-3, I24), since v2 calls the provider Start directly
// with FreshOnly.
var effectBannedFuncs = []string{
	"sessionFrontDoor",
	"preWakeCommit", "prepareStartCandidateForCity", "startPreparedStartCandidate", "runPreparedStartCandidate",
}

// effectLintAllowed are the named exceptions: in reconcile_steps_*.go only,
// the body of the function named by the key ("Recv.Name" for a method) may
// use the banned names listed. Each is a v5 R1 exception or a fenced write
// that checks its own writer, never a weakened ban.
var effectLintAllowed = map[string][]string{
	// K1's waits step hands legacy's wait pass a session front door: its only
	// session-row writes are the advisory wait-lookup-cap stamp (R1
	// exception 4) and clearSessionWaitHoldFenced (C8a).
	"externalReadsLane.waits": {"NewStore"},
	// The fenced wait-hold clear: it refuses unless a conditional writer
	// resolves, then writes by UpdateMetadataFenced (C8a).
	"clearSessionWaitHoldFenced": {"UpdateMetadataFenced"},
	// The execution backstop reads the row fresh through the front door
	// before posting its drain request to the planner; it writes nothing
	// (C8b).
	"externalReadsLane.requestExecutionStalled": {"sessionFrontDoor"},
}

// lintEffectSource returns one "file:line: name" per banned reference in
// src, parsed as path.
func lintEffectSource(t *testing.T, path string, src any) []string {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, src, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	steps := strings.HasPrefix(filepath.Base(path), "reconcile_steps_")
	var out []string
	for _, decl := range file.Decls {
		var allowed []string
		if fn, ok := decl.(*ast.FuncDecl); ok && steps {
			allowed = effectLintAllowed[funcDeclName(fn)]
		}
		ast.Inspect(decl, func(n ast.Node) bool {
			var name string
			switch n := n.(type) {
			case *ast.SelectorExpr:
				if slices.Contains(effectBannedMethods, n.Sel.Name) {
					name = n.Sel.Name
				}
			case *ast.Ident:
				if slices.Contains(effectBannedFuncs, n.Name) {
					name = n.Name
				}
			}
			if name != "" && !slices.Contains(allowed, name) {
				out = append(out, fmt.Sprintf("%s: %s", fset.Position(n.Pos()), name))
			}
			return true
		})
	}
	return out
}

// funcDeclName is fn's name, "Recv.Name" for a method.
func funcDeclName(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) == 0 {
		return fn.Name.Name
	}
	recv := fn.Recv.List[0].Type
	if star, ok := recv.(*ast.StarExpr); ok {
		recv = star.X
	}
	if id, ok := recv.(*ast.Ident); ok {
		return id.Name + "." + fn.Name.Name
	}
	return fn.Name.Name
}

// effectLintFiles are the files the lint covers.
func effectLintFiles(t *testing.T) []string {
	t.Helper()
	var files []string
	for _, pattern := range []string{"reconcile_effect_*.go", "reconcile_steps_*.go"} {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range matches {
			if !strings.HasSuffix(m, "_test.go") {
				files = append(files, m)
			}
		}
	}
	return files
}

// Kills a lint that matches nothing, a banned name dropped from it, an
// allowlist that leaks outside its function or its files, and a blind write
// in an effect or step: a generated fixture with one line per banned name
// trips each, each allowlisted function's own banned names pass only in a
// step file, and the effect and step files trip none.
func TestEffectLintBansBlindWrites(t *testing.T) {
	var src strings.Builder
	src.WriteString("package main\n\nfunc seeded(x fake) {\n")
	for _, m := range effectBannedMethods {
		fmt.Fprintf(&src, "\t_ = x.%s\n", m)
	}
	for _, f := range effectBannedFuncs {
		fmt.Fprintf(&src, "\t%s()\n", f)
	}
	src.WriteString("}\n")
	allowedUses := 0
	for _, fn := range slices.Sorted(maps.Keys(effectLintAllowed)) {
		decl := "func " + fn + "() {\n"
		if recv, name, ok := strings.Cut(fn, "."); ok {
			decl = "func (l *" + recv + ") " + name + "() {\n"
		}
		src.WriteString(decl)
		for _, banned := range effectLintAllowed[fn] {
			fmt.Fprintf(&src, "\t_ = x.%s\n", banned)
			allowedUses++
		}
		src.WriteString("}\n")
	}
	banned := len(effectBannedMethods) + len(effectBannedFuncs)

	got := lintEffectSource(t, "reconcile_effect_seeded.go", src.String())
	for _, name := range slices.Concat(effectBannedMethods, effectBannedFuncs) {
		if !slices.ContainsFunc(got, func(f string) bool { return strings.HasSuffix(f, ": "+name) }) {
			t.Errorf("the seeded %s is not reported", name)
		}
	}
	if len(got) != banned+allowedUses {
		t.Errorf("an effect file: %d findings, want %d (the allowlist applies to step files only)", len(got), banned+allowedUses)
	}
	if got := lintEffectSource(t, "reconcile_steps_seeded.go", src.String()); len(got) != banned {
		t.Errorf("a step file: %d findings, want every banned name outside the allowlisted functions only", len(got))
	}
	for _, f := range effectLintFiles(t) {
		for _, finding := range lintEffectSource(t, f, nil) {
			t.Errorf("blind write in an effect or step: %s", finding)
		}
	}
}
