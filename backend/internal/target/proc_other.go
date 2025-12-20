//go:build !darwin && !linux

package target

import "os/exec"

func configureDriverCmd(cmd *exec.Cmd) {}

func terminateDriverCmd(cmd *exec.Cmd) {
	// TODO: If Windows support becomes important, prefer a Job Object so child
	// processes don't outlive the backend.
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}

