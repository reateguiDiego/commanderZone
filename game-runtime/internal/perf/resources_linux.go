//go:build linux

package perf

import "syscall"

type processResources struct {
	userMS      float64
	systemMS    float64
	cpuMeasured bool
	rssBytes    uint64
	rssMeasured bool
}

func currentProcessResources() processResources {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return processResources{}
	}
	return processResources{
		userMS:      timevalMS(usage.Utime),
		systemMS:    timevalMS(usage.Stime),
		cpuMeasured: true,
		rssBytes:    uint64(usage.Maxrss) * 1024,
		rssMeasured: true,
	}
}

func timevalMS(value syscall.Timeval) float64 {
	return float64(value.Sec)*1000 + float64(value.Usec)/1000
}
