package main

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	overpassURL    = "https://overpass-api.de/api/interpreter"
	metersPerLat   = 110574.0
	metersPerLonEq = 111320.0
	codeRoad       = 0
	codeBuilding   = 1
	codePark       = 2
	codeWater      = 3
)

type District struct {
	Key  string  `json:"key"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

var districts = []District{
	{Key: "connaught-place", Name: "Connaught Place, New Delhi", Lat: 28.6315, Lon: 77.2167},
	{Key: "hitech-city", Name: "HITEC City, Hyderabad", Lat: 17.4435, Lon: 78.3772},
	{Key: "agartala-center", Name: "Agartala City Centre", Lat: 23.8315, Lon: 91.2868},
}

func findDistrict(key string) (District, bool) {
	for _, d := range districts {
		if d.Key == key {
			return d, true
		}
	}
	return District{}, false
}

type CityData struct {
	Name      string  `json:"name"`
	Source    string  `json:"source"`
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	RadiusM   float64 `json:"radius_m"`
	Footprint []int   `json:"footprint"`
	Heights   []int   `json:"heights"`
}

type latLon struct {
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
}

type osmElement struct {
	ID       int64             `json:"id"`
	Tags     map[string]string `json:"tags"`
	Geometry []latLon          `json:"geometry"`
}

type overpassResponse struct {
	Elements []osmElement `json:"elements"`
}

type bbox struct {
	south, north, west, east float64
}

func fetchOSMCity(parent context.Context, lat, lon, radius float64, name string) (*CityData, error) {
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()

	dLat := radius / metersPerLat
	dLon := radius / (metersPerLonEq * math.Cos(lat*math.Pi/180))
	box := bbox{south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon}

	form := url.Values{"data": {buildOverpassQuery(box)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, overpassURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "AeroScape/1.0 (hackathon demo)")

	client := &http.Client{Timeout: 16 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("overpass returned status %d", resp.StatusCode)
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	var parsed overpassResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}

	city, err := rasterize(parsed.Elements, box, name, lat, lon, radius)
	if err != nil {
		return nil, err
	}
	return city, nil
}

func buildOverpassQuery(b bbox) string {
	area := fmt.Sprintf("%f,%f,%f,%f", b.south, b.west, b.north, b.east)
	return fmt.Sprintf(`[out:json][timeout:15];
(
  way["building"](%[1]s);
  way["highway"~"^(primary|secondary|tertiary|residential|primary_link|secondary_link|tertiary_link)$"](%[1]s);
  way["leisure"~"^(park|garden|recreation_ground)$"](%[1]s);
  way["natural"="water"](%[1]s);
);
out geom;`, area)
}

func rasterize(elements []osmElement, b bbox, name string, lat, lon, radius float64) (*CityData, error) {
	n := gridSize
	footprint := make([]int, cellCount)
	heights := make([]int, cellCount)
	cellLat := (b.north - b.south) / float64(n)
	cellLon := (b.east - b.west) / float64(n)
	cellMeters := 2 * radius / float64(n)
	buildings := 0

	for row := 0; row < n; row++ {
		for col := 0; col < n; col++ {
			cLat := b.south + (float64(row)+0.5)*cellLat
			cLon := b.west + (float64(col)+0.5)*cellLon

			inBuilding, inWater, inPark, nearRoad := false, false, false, false
			tallest := 0.0

			for _, el := range elements {
				if len(el.Geometry) < 2 {
					continue
				}
				switch {
				case el.Tags["building"] != "":
					if len(el.Geometry) >= 3 && pointInPolygon(cLat, cLon, el.Geometry) {
						inBuilding = true
						tallest = math.Max(tallest, buildingHeight(el))
					}
				case el.Tags["natural"] == "water":
					if len(el.Geometry) >= 3 && pointInPolygon(cLat, cLon, el.Geometry) {
						inWater = true
					}
				case el.Tags["leisure"] != "":
					if len(el.Geometry) >= 3 && pointInPolygon(cLat, cLon, el.Geometry) {
						inPark = true
					}
				case el.Tags["highway"] != "":
					if distanceToPolylineM(cLat, cLon, el.Geometry, lat) < cellMeters*0.45 {
						nearRoad = true
					}
				}
			}

			i := row*n + col
			switch {
			case inBuilding:
				footprint[i] = codeBuilding
				heights[i] = clampHeight(tallest)
				buildings++
			case inWater:
				footprint[i] = codeWater
			case inPark && !nearRoad:
				footprint[i] = codePark
			default:
				footprint[i] = codeRoad
			}
		}
	}

	if buildings < 5 {
		return nil, fmt.Errorf("only %d buildings found in OSM data", buildings)
	}

	return &CityData{
		Name:      name,
		Source:    "overpass",
		Lat:       lat,
		Lon:       lon,
		RadiusM:   radius,
		Footprint: footprint,
		Heights:   heights,
	}, nil
}

func buildingHeight(el osmElement) float64 {
	if raw, ok := el.Tags["height"]; ok {
		cleaned := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(raw), "m"))
		if v, err := strconv.ParseFloat(cleaned, 64); err == nil && v > 0 {
			return v
		}
	}
	if raw, ok := el.Tags["building:levels"]; ok {
		if v, err := strconv.ParseFloat(strings.TrimSpace(raw), 64); err == nil && v > 0 {
			return v * 3.2
		}
	}
	rng := rand.New(rand.NewSource(el.ID))
	return 12 + rng.Float64()*24
}

func pointInPolygon(lat, lon float64, poly []latLon) bool {
	inside := false
	j := len(poly) - 1
	for i := range poly {
		yi, xi := poly[i].Lat, poly[i].Lon
		yj, xj := poly[j].Lat, poly[j].Lon
		if (yi > lat) != (yj > lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi {
			inside = !inside
		}
		j = i
	}
	return inside
}

func distanceToPolylineM(lat, lon float64, line []latLon, refLat float64) float64 {
	mLon := metersPerLonEq * math.Cos(refLat*math.Pi/180)
	px, py := lon*mLon, lat*metersPerLat
	best := math.Inf(1)
	for i := 0; i+1 < len(line); i++ {
		ax, ay := line[i].Lon*mLon, line[i].Lat*metersPerLat
		bx, by := line[i+1].Lon*mLon, line[i+1].Lat*metersPerLat
		if d := pointSegmentDist(px, py, ax, ay, bx, by); d < best {
			best = d
		}
	}
	return best
}

func pointSegmentDist(px, py, ax, ay, bx, by float64) float64 {
	dx, dy := bx-ax, by-ay
	l2 := dx*dx + dy*dy
	t := 0.0
	if l2 > 0 {
		t = ((px-ax)*dx + (py-ay)*dy) / l2
	}
	t = math.Max(0, math.Min(1, t))
	cx, cy := ax+t*dx, ay+t*dy
	return math.Hypot(px-cx, py-cy)
}

// presetCity builds a deterministic, realistic-looking district when OSM is unavailable.
func presetCity(name string, lat, lon, radius float64) *CityData {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	seed := int64(h.Sum64() & 0x7fffffffffffffff)
	rng := rand.New(rand.NewSource(seed))

	n := gridSize
	offX, offY := rng.Intn(5), rng.Intn(5)
	blockShift := int(seed % 3)
	half := float64(n) / 2

	footprint := make([]int, cellCount)
	heights := make([]int, cellCount)

	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			i := y*n + x
			gx, gy := x+offX, y+offY
			switch {
			case gx%5 == 0 || gy%5 == 0:
				footprint[i] = codeRoad
			case ((gx/5)*3+(gy/5)*7+blockShift)%5 == 0:
				footprint[i] = codePark
			default:
				footprint[i] = codeBuilding
				d := math.Hypot(float64(x)-half, float64(y)-half) / half
				core := math.Max(0, 1-d)
				heights[i] = clampHeight(10 + 45*core*core + rng.Float64()*18)
			}
		}
	}

	return &CityData{
		Name:      name,
		Source:    "preset",
		Lat:       lat,
		Lon:       lon,
		RadiusM:   radius,
		Footprint: footprint,
		Heights:   heights,
	}
}

func clampHeight(h float64) int {
	v := int(math.Round(h))
	if v < 3 {
		return 3
	}
	if v > 300 {
		return 300
	}
	return v
}

func clampF(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}