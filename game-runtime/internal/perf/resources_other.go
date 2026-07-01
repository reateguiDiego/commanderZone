//go:build !linux

package perf

type processResources struct {
	userMS      float64
	systemMS    float64
	cpuMeasured bool
	rssBytes    uint64
	rssMeasured bool
}

func currentProcessResources() processResources {
	return processResources{}
}
