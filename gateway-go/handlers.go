package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	gridSize  = 20
	cellCount = gridSize * gridSize
	maxBody   = 1 << 20
	minIrr    = 200
	maxIrr    = 1100
)

var (
	validCovers  = map[string]bool{"asphalt": true, "white_paint": true, "trees": true, "water": true}
	validPresets = map[string]bool{
		"baseline":            true,
		"cool_roof_mandate":   true,
		"green_corridor":      true,
		"green_street_hybrid": true,
	}
)

type api struct {
	base   string
	client *http.Client
}

func newAPI(base string) *api {
	return &api{
		base:   strings.TrimRight(base, "/"),
		client: &http.Client{Timeout: 8 * time.Second},
	}
}

func (a *api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/health", a.health)
	mux.HandleFunc("GET /api/grid", a.passThrough(http.MethodGet, "/grid"))
	mux.HandleFunc("POST /api/intervene", a.intervene)
	mux.HandleFunc("POST /api/batch-intervene", a.batchIntervene)
	mux.HandleFunc("POST /api/irradiance", a.irradiance)
	mux.HandleFunc("POST /api/load-city", a.loadCity)
	mux.HandleFunc("POST /api/reset", a.passThrough(http.MethodPost, "/reset"))
	mux.HandleFunc("GET /api/osm-city", a.osmCity)
	mux.HandleFunc("GET /api/districts", a.districtList)
}

func (a *api) health(w http.ResponseWriter, r *http.Request) {
	engine := "ok"
	status, _, err := a.call(http.MethodGet, "/health", nil)
	if err != nil || status != http.StatusOK {
		engine = "unreachable"
	}
	writeJSON(w, http.StatusOK, map[string]string{"gateway": "ok", "engine": engine})
}

func (a *api) passThrough(method, path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		a.forward(w, method, path, nil)
	}
}

type interveneReq struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Cover string `json:"cover"`
}

func (a *api) intervene(w http.ResponseWriter, r *http.Request) {
	var req interveneReq
	if err := decodeJSON(w, r, &req); err != nil {
		badRequest(w, "invalid body: "+err.Error())
		return
	}
	if err := validateCell(req.X, req.Y); err != nil {
		badRequest(w, err.Error())
		return
	}
	if !validCovers[req.Cover] {
		badRequest(w, "unknown cover type")
		return
	}
	a.forward(w, http.MethodPost, "/intervene", req)
}

type cellPaint struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Cover string `json:"cover"`
}

type batchReq struct {
	Cells  []cellPaint `json:"cells,omitempty"`
	Preset string      `json:"preset,omitempty"`
}

func (a *api) batchIntervene(w http.ResponseWriter, r *http.Request) {
	var req batchReq
	if err := decodeJSON(w, r, &req); err != nil {
		badRequest(w, "invalid body: "+err.Error())
		return
	}
	if len(req.Cells) == 0 && req.Preset == "" {
		badRequest(w, "provide cells or a preset")
		return
	}
	if len(req.Cells) > cellCount {
		badRequest(w, "too many cells in one batch")
		return
	}
	if req.Preset != "" && !validPresets[req.Preset] {
		badRequest(w, "unknown preset")
		return
	}
	for _, c := range req.Cells {
		if err := validateCell(c.X, c.Y); err != nil {
			badRequest(w, err.Error())
			return
		}
		if !validCovers[c.Cover] {
			badRequest(w, "unknown cover type")
			return
		}
	}
	a.forward(w, http.MethodPost, "/batch-intervene", req)
}

type irradianceReq struct {
	Irradiance float64 `json:"irradiance"`
}

func (a *api) irradiance(w http.ResponseWriter, r *http.Request) {
	var req irradianceReq
	if err := decodeJSON(w, r, &req); err != nil {
		badRequest(w, "invalid body: "+err.Error())
		return
	}
	if req.Irradiance < minIrr || req.Irradiance > maxIrr {
		badRequest(w, "irradiance must be between 200 and 1100 W/m2")
		return
	}
	a.forward(w, http.MethodPost, "/irradiance", req)
}

type loadCityReq struct {
	Name      string `json:"name"`
	Footprint []int  `json:"footprint"`
	Heights   []int  `json:"heights"`
}

func (a *api) loadCity(w http.ResponseWriter, r *http.Request) {
	var req loadCityReq
	if err := decodeJSON(w, r, &req); err != nil {
		badRequest(w, "invalid body: "+err.Error())
		return
	}
	if len(req.Name) > 80 {
		badRequest(w, "name is too long")
		return
	}
	if len(req.Footprint) != cellCount || len(req.Heights) != cellCount {
		badRequest(w, "footprint and heights must each contain 400 values")
		return
	}
	for i := range req.Footprint {
		if req.Footprint[i] < 0 || req.Footprint[i] > 3 {
			badRequest(w, "footprint codes must be 0 to 3")
			return
		}
		if req.Heights[i] < 0 || req.Heights[i] > 300 {
			badRequest(w, "heights must be 0 to 300 m")
			return
		}
	}
	a.forward(w, http.MethodPost, "/load-city", req)
}

func (a *api) osmCity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	radius := 350.0
	if raw := q.Get("radius"); raw != "" {
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			badRequest(w, "radius must be a number")
			return
		}
		radius = clampF(v, 150, 600)
	}

	var lat, lon float64
	var name string

	if key := q.Get("district"); key != "" {
		d, ok := findDistrict(key)
		if !ok {
			badRequest(w, "unknown district")
			return
		}
		lat, lon, name = d.Lat, d.Lon, d.Name
	} else {
		var err error
		lat, err = strconv.ParseFloat(q.Get("lat"), 64)
		if err != nil {
			badRequest(w, "lat must be a number")
			return
		}
		lon, err = strconv.ParseFloat(q.Get("lon"), 64)
		if err != nil {
			badRequest(w, "lon must be a number")
			return
		}
		if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
			badRequest(w, "coordinates out of range")
			return
		}
		name = strings.TrimSpace(q.Get("name"))
		if name == "" {
			name = "Custom Area"
		}
	}

	city, err := fetchOSMCity(r.Context(), lat, lon, radius, name)
	if err != nil {
		log.Printf("OSM fetch failed, using procedural preset: %v", err)
		city = presetCity(name, lat, lon, radius)
	}
	writeJSON(w, http.StatusOK, city)
}

func (a *api) districtList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, districts)
}

func (a *api) forward(w http.ResponseWriter, method, path string, payload any) {
	var body []byte
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "could not encode request")
			return
		}
		body = b
	}

	status, data, err := a.call(method, path, body)
	if err != nil {
		log.Printf("engine call %s %s failed: %v", method, path, err)
		writeJSONError(w, http.StatusBadGateway, "rust engine unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

func (a *api) call(method, path string, body []byte) (int, []byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, a.base+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, data, err
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func validateCell(x, y int) error {
	if x < 0 || y < 0 || x >= gridSize || y >= gridSize {
		return fmt.Errorf("cell (%d, %d) is outside the %dx%d grid", x, y, gridSize, gridSize)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func badRequest(w http.ResponseWriter, msg string) {
	writeJSONError(w, http.StatusBadRequest, msg)
}