//go:build darwin || linux

package target

import (
	"os/exec"
	"syscall"
	"time"
)

func configureDriverCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminateDriverCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}

	// Kill the whole process group to avoid leaking child processes created by
	// shell wrappers (e.g. `bash -c ...`) or by the driver itself.
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)

	go func(pid int) {
		time.Sleep(2 * time.Second)
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}(cmd.Process.Pid)
}
