import { useState, useEffect, useMemo, useRef, memo, Fragment } from "react";
import { createPortal } from "react-dom";
import PanelToggleIcon from "./PanelToggleIcon";
import StationMapMarker from "./StationMapMarker";
import {
  MapContainer,
  AttributionControl,
  TileLayer,
  Marker,
  Polyline,
  CircleMarker,
  GeoJSON,
  Tooltip,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/MapArea.css";
import ConfirmModal from "./ConfirmModal";
import CommandBasemapSelector from "./CommandBasemapSelector";
import GooglePhotorealisticMap from "./GooglePhotorealisticMap";
import RasterCommandMap from "./RasterCommandMap";
import HeatmapPanel from "./HeatmapPanel";
import RoadEdgeSelector from "./RoadEdgeSelector";
import ConstraintEdgeSaveDialog from "./ConstraintEdgeSaveDialog";
import { toggleRoadEdge } from "../utils/roadEdgeSelection";
import ConstraintLayersPanel from "./ConstraintLayersPanel";
import { buildConstraintLayers, constraintLayerId } from "../utils/constraintLayers";
import HeatmapIncidents from "./HeatmapIncidents";
import { useHeatmap } from "../hooks/useHeatmap";
import { EMPTY_HEATMAP, filterHeatmapPoints, heatmapSurface } from "../utils/heatmap";
import { heatmapOpacity } from "../utils/heatmapOpacity";
import { readCommandBasemap, saveCommandBasemap } from "../utils/commandBasemap";

import { MAP_CENTER, MAP_ZOOM, tileLayersFor, REGION_BOUNDARY } from "../data/mapConfig";
import { useTheme, readCssVar } from "../hooks/useTheme";
import { activeLayersFor } from "../utils/mapLayers";
import { PANABO_BOUNDARY_COLOR, BARANGAY_BOUNDARY_COLOR, NARROW_ROAD_COLOR, TRAFFIC_AREA_COLOR, roadConstraintColor } from "../utils/mapOverlayColors";
import {
  fetchObstructions,
  snapToRoad,
  createObstruction,
  deleteObstruction,
  fetchGnnConstraints,
  fetchConstraints,
  fetchConstraintRoadEdges,
  saveConstraintEdges,
  deleteConstraint,
  fetchBarangays,
} from "../api";

function FireGeneralIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sev-icon"
      fill="currentColor"
    >
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg>
  );
}

const ZOOM = MAP_ZOOM;
const PERSONNEL_MIN_ZOOM = 13;
// Hide personnel whose last known location is older than this (8 hours).
const PERSONNEL_STALE_HIDE_MINUTES = 8 * 60;
const BARANGAY_LABEL_MIN_ZOOM = 13;

const LAYER_LABELS = [
  "Incidents",
  "Personnel",
  "Stations",
  "Routes",
  "Heat Map",
  "GNN Constraints",
  "Barangay",
];

function toIconSeverity(inc) {
  if (inc.status === "contained") return "contained";
  const s = (inc.sev || "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "moderate") return "moderate";
  return "contained";
}

// ── Picking-mode helpers (must be inside MapContainer) ───────────────────────
function ZoomTracker({ onZoom }) {
  const map = useMapEvents({
    zoomend() {
      onZoom(map.getZoom());
    },
  });
  return null;
}

function MapClickHandler({
  active,
  onPick,
  onObstructionPick,
  onObstructionHover,
  obstructionActive,
}) {
  useMapEvents({
    click(e) {
      const latlng = [e.latlng.lat, e.latlng.lng];
      if (obstructionActive) onObstructionPick(latlng);
      else if (active) onPick(latlng);
    },
    mousemove(e) {
      if (obstructionActive) onObstructionHover([e.latlng.lat, e.latlng.lng]);
    },
    mouseout() {
      if (obstructionActive) onObstructionHover(null);
    },
  });
  return null;
}

function CursorController({ active }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().classList.toggle("pick-cursor", active);
    return () => map.getContainer().classList.remove("pick-cursor");
  }, [active, map]);
  return null;
}

/**
 * Keep Leaflet's idea of the container size in step with the real one.
 *
 * Leaflet caches the container's pixel dimensions and only re-measures when it
 * is told to. Anything that resizes the container without a window resize event
 * — collapsing the navigation rail, opening the incident panel, the browser
 * zooming — leaves that cache stale, and every pixel-to-coordinate conversion
 * built on it is then off by the difference. The symptom is a map that feels
 * "sticky" or offset while dragging, and clicks that land away from the cursor.
 *
 * A ResizeObserver catches every cause at once, including the ones no prop
 * change would tell us about. Calls are coalesced into one per animation frame
 * so a continuous resize can't queue a recalculation per observer callback.
 */
function MapResizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let frame = null;

    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        // animate: false — this is a correction, not a transition; letting it
        // ease would fight whatever gesture is in flight.
        map.invalidateSize({ animate: false });
      });
    });
    observer.observe(container);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

// Flies to an arbitrary point (an incident or station opened from a details
// page). `mapFocus` is { lat, lng, zoom?, nonce }; a new nonce re-fires it.
function MapFocuser({ mapFocus }) {
  const map = useMap();
  useEffect(() => {
    if (mapFocus?.lat == null || mapFocus?.lng == null) return;
    const animate = document.documentElement.dataset.motion !== "off";
    if (mapFocus.bounds?.length) {
      map.fitBounds(mapFocus.bounds, { paddingTopLeft: [340, 80], paddingBottomRight: [50, 70], maxZoom: 18, animate });
      return;
    }
    map.flyTo([mapFocus.lat, mapFocus.lng], mapFocus.zoom ?? 17, {
      animate,
      duration: animate ? 0.9 : 0,
    });
  }, [mapFocus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function PersonnelFocuser({ focusedPersonnel, livePersonnelLocations }) {
  const map = useMap();
  useEffect(() => {
    if (!focusedPersonnel?.per_id) return;
    const p = livePersonnelLocations.find(
      (x) => x.per_id === focusedPersonnel.per_id
    );
    if (p?.latitude != null && p?.longitude != null) {
      // Leaflet's own animation is out of CSS's reach, so the Animations
      // preference has to be read here too — otherwise turning motion off
      // still leaves the map gliding across the city.
      const animate = document.documentElement.dataset.motion !== "off";
      map.flyTo([p.latitude, p.longitude], Math.max(map.getZoom(), 16), {
        animate,
        duration: animate ? 0.9 : 0,
      });
    }
    // Re-fires whenever the user clicks Map again (nonce changes).
  }, [focusedPersonnel?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function reporterIcon() {
  return L.divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div class="reporter-pin">
             <div class="reporter-pin-ring"></div>
             <div class="reporter-pin-core"></div>
           </div>`,
  });
}

function newIncidentIcon() {
  return L.divIcon({
    className: "",
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div class="new-inc-pin">
             <div class="new-inc-ring"></div>
             <div class="new-inc-core">+</div>
           </div>`,
  });
}

// ── Icon factories ────────────────────────────────────────────────────────────
// Incident severity → marker/route colors. Shared so a dispatch route is drawn
// in the same color as the incident pin it leads to.
const SEVERITY_COLORS = {
  critical:  { color: "#ff4d1a", shadow: "rgba(255,77,26,0.6)" },
  moderate:  { color: "#ffb020", shadow: "rgba(255,176,32,0.5)" },
  contained: { color: "#00e676", shadow: "rgba(0,160,75,0.7)" },
};

function severityColor(inc) {
  return (SEVERITY_COLORS[toIconSeverity(inc)] || SEVERITY_COLORS.contained).color;
}

function fireIcon(severity, selected = false, isNew = false) {
  const sc = SEVERITY_COLORS[severity] || SEVERITY_COLORS.contained;
  const color = sc.color;
  const shadow = sc.shadow;
  const opacity = "1";
  const pulse = severity === "critical";

  return L.divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `
      <div class="fire-marker" style="opacity:${opacity}">
        ${
          selected
            ? `<div class="fire-ripple" style="border-color:${color}"></div>`
            : ""
        }
        ${
          pulse
            ? `<div class="fire-pulse-ring" style="border-color:${color}"></div>`
            : ""
        }
        ${
          isNew
            ? `<div class="fire-new-ring" style="border-color:${color}"></div><div class="fire-new-ring fire-new-ring-delay" style="border-color:${color}"></div>`
            : ""
        }
        <div class="fire-marker-inner" style="background:${color};box-shadow:0 0 16px ${shadow}"></div>
      </div>`,
  });
}

function personnelIcon(initials, color, shadow, deviated = false) {
  const badge = deviated
    ? `<div style="position:absolute;top:-6px;right:-6px;width:14px;height:14px;border-radius:50%;background:#ffb020;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#000;border:1.5px solid #0a0c0f;">!</div>`
    : "";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="position:relative;display:inline-block">
             <div class="personnel-marker" style="border-color:${color};color:${color};box-shadow:0 0 10px ${shadow}">${initials}</div>
             ${badge}
           </div>`,
  });
}

function stationIcon() {
  return L.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div class="station-marker">
    <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="var(--accent-green)"><path d="M300-240v-360h360v360-360H300v360Zm-60 0h60v-360h360v360h60v-366L480-780 240-606v366Zm120-240h240v-60H360v60Zm120-160q17 0 28.5-11.5T520-680q0-17-11.5-28.5T480-720q-17 0-28.5 11.5T440-680q0 17 11.5 28.5T480-640ZM160-160v-400H39l441-320 440 320H800v400H600v-260H360v260H160Z"/>
    </svg></div>`,
  });
}

function IncidentMapTooltip({ id, status, location, severity, alarm, units }) {
  return <div className="command-incident-tooltip">
    <div className="command-tooltip-header">
      <span className="command-tooltip-id">{id}</span>
      <span className="command-tooltip-status">{status?.replaceAll("_", " ")}</span>
    </div>
    <div className="command-tooltip-heading">{location || "Incident location"}</div>
    <div className="command-tooltip-meta">
      {severity && <span>{severity}</span>}
      {alarm && <span>{alarm}</span>}
      {units != null && <span>{units} unit{units !== 1 ? "s" : ""}</span>}
    </div>
  </div>;
}

// ── Road obstruction types & icon ────────────────────────────────────────────
// `blocks` mirrors OBSTRUCTION_SEVERITY in the routing engine: blockade and
// flood are infinite cost (the truck cannot pass at all), repair and accident
// are multipliers (it gets through, slowly). That is the distinction a
// dispatcher has to read at a glance, so it drives the marker's shape --
// solid = impassable, outlined = passable but slow -- not only its colour.
//
// `glyph` is static SVG markup, shared by the Leaflet divIcon (which needs an
// HTML string) and <ObstructionGlyph> (which renders it in React). One source
// of truth beats maintaining the same four icons twice, and it inherits
// currentColor either way, so both follow the theme.
const OBSTRUCTION_TYPES = [
  {
    id: "blockade",
    fallback: "#ef4444",
    label: "Blockade",
    token: "--accent-red",
    blocks: true,
    effect: "Impassable — routes around it",
    glyph: '<circle cx="12" cy="12" r="8.5"/><line x1="7" y1="12" x2="17" y2="12"/>',
  },
  {
    id: "flood",
    fallback: "#38bdf8",
    label: "Flood",
    token: "--accent-cyan",
    blocks: true,
    effect: "Impassable — routes around it",
    glyph:
      '<path d="M3 15q2.75-3 5.5 0t5.5 0 5.5 0"/><path d="M3 9.5q2.75-3 5.5 0t5.5 0 5.5 0"/>',
  },
  {
    id: "accident",
    fallback: "#ff4d1a",
    label: "Accident",
    token: "--accent-fire",
    blocks: false,
    effect: "Slows traffic heavily",
    glyph:
      '<path d="M12 4.5 20.5 19H3.5Z"/><line x1="12" y1="10" x2="12" y2="13.5"/><line x1="12" y1="16.2" x2="12" y2="16.3"/>',
  },
  {
    id: "repair",
    fallback: "#ffb020",
    label: "Repair",
    token: "--accent-amber",
    blocks: false,
    effect: "Slows traffic",
    glyph:
      '<rect x="3" y="9" width="18" height="6" rx="1.2"/><line x1="8" y1="9" x2="5" y2="15"/><line x1="13" y1="9" x2="10" y2="15"/><line x1="18" y1="9" x2="15" y2="15"/>',
  },
];

function obsInfo(type) {
  return OBSTRUCTION_TYPES.find((t) => t.id === type) || OBSTRUCTION_TYPES[0];
}

// Inline SVG coloured by currentColor, so the caller sets the theme token.
function ObstructionGlyph({ type, size = 14 }) {
  const info = obsInfo(type);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Static module constant above, never user input.
      dangerouslySetInnerHTML={{ __html: info.glyph }}
    />
  );
}

// An obstruction is drawn as a bar laid across the carriageway rather than a
// pin beside it, so there is no ambiguity about which road it closes. The bar
// is perpendicular to the road's bearing and sized in metres, so it stays
// glued to the road at every zoom instead of drifting off it.
const OBS_BAR_HALF_M = 11;

function obstructionBar(obs) {
  if (obs.bearing_deg == null) return null;
  const rad = ((obs.bearing_deg + 90) * Math.PI) / 180;
  const dLat = (OBS_BAR_HALF_M * Math.cos(rad)) / 111320;
  const dLon =
    (OBS_BAR_HALF_M * Math.sin(rad)) /
    (111320 * Math.cos((obs.latitude * Math.PI) / 180));
  return [
    [obs.latitude - dLat, obs.longitude - dLon],
    [obs.latitude + dLat, obs.longitude + dLon],
  ];
}

// Same marker, faded: shows where a click would actually drop the obstruction
// once it has been snapped to the road.
function obstructionGhostIcon(type) {
  const info = obsInfo(type);
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="obstruction-marker obstruction-marker--ghost${
      info.blocks ? " obstruction-marker--blocking" : ""
    }" style="--obs:var(${info.token})">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">${info.glyph}</svg>
           </div>`,
  });
}

function obstructionIcon(type) {
  const info = obsInfo(type);
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="obstruction-marker${
      info.blocks ? " obstruction-marker--blocking" : ""
    }" style="--obs:var(${info.token})">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">${info.glyph}</svg>
           </div>`,
  });
}

// ── Coverage mask + boundary ──────────────────────────────────────────────────
// Must be rendered inside MapContainer (uses useMap hook)
function CoverageLayers() {
  const map = useMap();
  const theme = useTheme();

  useEffect(() => {
    // Inject diagonal hatch pattern into the Leaflet SVG overlay pane
    const svg = map.getPanes().overlayPane.querySelector("svg");
    if (!svg || svg.querySelector("#cov-hatch")) return;

    const NS = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(NS, "defs");
    const pattern = document.createElementNS(NS, "pattern");
    const line = document.createElementNS(NS, "line");

    Object.entries({
      id: "cov-hatch",
      patternUnits: "userSpaceOnUse",
      width: "10",
      height: "10",
      patternTransform: "rotate(45 0 0)",
    }).forEach(([k, v]) => pattern.setAttribute(k, v));

    Object.entries({
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "10",
      stroke: "rgba(30,144,255,0.15)",
      "stroke-width": "1.5",
    }).forEach(([k, v]) => line.setAttribute(k, v));

    pattern.appendChild(line);
    defs.appendChild(pattern);
    svg.insertBefore(defs, svg.firstChild);
  }, [map]);

  // World polygon with the active region cut out as a hole
  const maskFeature = useMemo(
    () => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        // GeoJSON: outer ring CCW, inner ring (hole) CW
        // evenodd fill-rule used by Leaflet handles both orientations correctly
        coordinates: [
          [
            [-180, -90],
            [-180, 90],
            [180, 90],
            [180, -90],
            [-180, -90],
          ],
          REGION_BOUNDARY,
        ],
      },
    }),
    []
  );

  // Boundary stroke has to be a resolved value, not var(--accent-fire): Leaflet
  // writes it to the SVG `stroke` attribute, which does not evaluate CSS custom
  // properties. Re-resolve on theme flip, and key the layer on the result so
  // Leaflet re-applies it instead of keeping the colour it read on mount.
  const boundaryColor = useMemo(
    () => readCssVar("--accent-fire", "#ff4d1a"),
    // readCssVar reads the resolved value off the DOM, so `theme` is the
    // invalidation trigger rather than an input the linter can see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );

  // Active-region outline only (no fill)
  const boundaryFeature = useMemo(
    () => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [REGION_BOUNDARY] },
    }),
    []
  );

  return (
    <>
      {/* Dark semi-transparent overlay outside the active region */}
      {/* <GeoJSON
        key="mask-dark"
        data={maskFeature}
        style={() => ({
          fillColor: "rgba(232, 57, 13, 0.07)",
          fillOpacity: 0.75,
          stroke: false,
        })}
      /> */}

      {/* Diagonal hatch overlay — fill applied via CSS (overrides SVG attribute) */}
      <GeoJSON
        key="mask-hatch"
        data={maskFeature}
        style={() => ({
          className: "cov-hatch-path",
          fillOpacity: 1,
          stroke: false,
        })}
      />

      {/* Jurisdiction boundary — strong Panabo orange outline */}
      <GeoJSON
        key={`boundary-${boundaryColor}`}
        data={boundaryFeature}
        style={() => ({
          className: "jurisdiction-boundary",
          fill: false,
          stroke: true,
          color: PANABO_BOUNDARY_COLOR,
          weight: 4,
          opacity: 1,
        })}
      />
    </>
  );
}

// ── Barangay boundary overlay ────────────────────────────────────────────────
function barangayLabelIcon(name, population) {
  const popText =
    population != null
      ? Number(population).toLocaleString("en-US")
      : "—";
  return L.divIcon({
    className: "barangay-map-label",
    iconSize: [140, 40],
    iconAnchor: [70, 20],
    html: `<div class="brgy-label">
             <div class="brgy-label-name">${name}</div>
             <div class="brgy-label-pop">Est. pop: ${popText}</div>
           </div>`,
  });
}

function BarangayLayer({ featureCollection, showLabels = true }) {
  if (!featureCollection?.features?.length) return null;

  const style = () => ({
    className: "barangay-boundary",
    color: BARANGAY_BOUNDARY_COLOR,
    weight: 2,
    opacity: 0.95,
    fillColor: BARANGAY_BOUNDARY_COLOR,
    fillOpacity: 0.08,
  });

  const labels = featureCollection.features.map((f) => {
    const layer = L.geoJSON(f);
    const center = layer.getBounds().getCenter();
    const { brgy_id, brgy_name, brgy_estpopulation } = f.properties || {};
    return {
      id: brgy_id ?? brgy_name,
      name: brgy_name || "Unnamed",
      population: brgy_estpopulation,
      lat: center.lat,
      lng: center.lng,
    };
  });

  return (
    <>
      <GeoJSON
        key={`brgy-${featureCollection.features.length}`}
        data={featureCollection}
        style={style}
      />
      {showLabels &&
        labels.map((l) => (
          <Marker
            key={`brgy-label-${l.id}`}
            position={[l.lat, l.lng]}
            icon={barangayLabelIcon(l.name, l.population)}
            interactive={false}
            keyboard={false}
          />
        ))}
    </>
  );
}

// The original Leaflet layers remain available when the enhanced raster
// renderer cannot start (for example when WebGL is unavailable).
function HeatmapLayer({ data }) {
  const map = useMap();

  useEffect(() => {
    const style = feature => ({ stroke: false, fillColor: feature.properties.color,
      fillOpacity: heatmapOpacity(map.getZoom(), feature.properties.opacity) });
    const layer = L.geoJSON(data, { interactive: false, style }).addTo(map);
    const update = () => layer.setStyle(style);
    map.on("zoom", update);
    return () => { map.off("zoom", update); map.removeLayer(layer); };
  }, [map, data]);

  return null;
}

const NORMAL_ROAD_COLOR = "#B0BEC5";
const GnnConstraintsLayer = memo(function GnnConstraintsLayer({ data }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const ordered = useMemo(() => {
    const features = data?.constraints?.features;
    if (!features?.length) return [];
    return [...features]
      .sort((a, b) => {
        const an = a.properties?.display_constraint_type === "normal" ? 0 : 1;
        const bn = b.properties?.display_constraint_type === "normal" ? 0 : 1;
        return an - bn;
      })
      .map((feature, index) => {
        const props = feature.properties || {};
        return {
          key: `gc-${props.road_id ?? index}-${index}`,
          props,
          isNormal: props.display_constraint_type === "normal",
          positions: feature.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
        };
      });
  }, [data]);

  return <>{ordered.map(({ key, props, isNormal, positions }) => {
    const color = props.map_color || NORMAL_ROAD_COLOR;
    const pathOptions = {
      color,
      weight: props.map_weight || 2,
      opacity: props.map_opacity ?? 0.85,
      renderer,
      interactive: !isNormal,
    };
    if (isNormal) return <Polyline key={key} positions={positions} pathOptions={pathOptions} />;
    const confidence = props.hover_confidence_text ||
      (props.final_display_confidence_pct != null
        ? `Confidence ${props.final_display_confidence_pct.toFixed(0)}%`
        : null);
    return (
      <Polyline key={key} positions={positions} pathOptions={pathOptions}>
        <Tooltip sticky className="leaflet-dark-tooltip">
          <div className="tooltip-id" style={{ color }}>
            {props.display_label || props.display_constraint_type}
          </div>
          {(props.name || props.barangay) && (
            <div className="tooltip-sub">{[props.name, props.barangay].filter(Boolean).join(" · ")}</div>
          )}
          <div className="tooltip-sub">
            Avoidance ×{props.routing_multiplier ?? 1}
            {confidence ? ` · ${confidence}` : ""}
            {props.custom ? " · custom" : ""}
          </div>
        </Tooltip>
      </Polyline>
    );
  })}</>;
});


// Legend driven by the server-built meta.legend (already sorted, and covering
// the GAT-only prediction buckets the style config doesn't define). Normal
// roads are the faint backdrop and are omitted from the legend.
function GnnLegend({ data }) {
  const items = (data?.meta?.legend || []).filter((it) => it.type !== "normal");

  return (
    <section className="gnn-legend" aria-label="Predicted road constraints">
      <div className="constraint-section-heading">
        <span>{data?.meta?.model || "GAT"} predictions</span>
        <span className="gnn-legend-count"><strong>{(data?.meta?.constrained ?? 0).toLocaleString()}</strong> / {(data?.meta?.total ?? 0).toLocaleString()} roads</span>
      </div>
      <div className="gnn-legend-items">
        {items.map((it) => (
          <div key={it.type} className="gnn-legend-item">
            <span className="gnn-legend-swatch" style={{ background: it.color }} />
            <span>{it.label}</span><strong>{(it.count ?? 0).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      {!(data?.meta?.constrained > 0) && <p className="constraint-help">No constrained roads in this dataset.</p>}
    </section>
  );
}

// ── Constraint types ─────────────────────────────────────────────────────────
const CONSTRAINT_TYPES = [
  {
    id: "narrow_road",
    label: "Narrow Road",
    color: NARROW_ROAD_COLOR,
    symbol: "⊘",
  },
  {
    id: "traffic_area",
    label: "Traffic Crowded Area",
    color: TRAFFIC_AREA_COLOR,
    symbol: "◈",
  },
];
// Layer tools keep their state in MapArea and render into the shared right
// dock below the camera controls. Match the Actions panel's header and controls.
function ObstructionPanel({
  open,
  onToggleOpen,
  placingType,
  onStartPlace,
  onCancelPlace,
  obstructions,
  onDelete,
}) {
  if (!open) {
    return (
      <button
        type="button"
        className="obstruction-float-btn"
        onClick={onToggleOpen}
        title="Expand obstructions"
        aria-expanded={false}
        aria-label="Expand road obstructions"
      >
        <PanelToggleIcon />
        Obstructions
        <span className="obstruction-count">{obstructions.length}</span>
      </button>
    );
  }

  return (
    <section className="obstruction-panel" aria-label="Road obstructions">
      <div className="obstruction-panel-head">
        <button
          type="button"
          className="obstruction-collapse-btn"
          onClick={onToggleOpen}
          title="Collapse"
          aria-label="Collapse obstructions"
          aria-expanded={true}
        >
          <PanelToggleIcon expanded />
        </button>
        <div className="obstruction-panel-title">Road obstructions</div>
      </div>

      <div className="obstruction-panel-body">
        <div className="obstruction-section-label">Add to map</div>
        <div className="obstruction-panel-tools">
          {OBSTRUCTION_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="obstruction-type-btn"
                style={{ "--obs": `var(${t.token})` }}
                onClick={() => onStartPlace(t.id)}
                title={`${t.label} - ${t.effect}`}
                aria-label={`Place ${t.label.toLowerCase()}`}
                aria-pressed={placingType === t.id}
              >
                <span className="obstruction-type-icon"><ObstructionGlyph type={t.id} size={16} /></span>
                <span className="obstruction-type-copy"><span>{t.label}</span><small>{t.blocks ? "Closed road" : t.id === "accident" ? "Heavy delay" : "Slower travel"}</small></span>
              </button>
            ))}
        </div>
        {placingType ? <div className="obstruction-placement" style={{ "--obs": `var(${obsInfo(placingType).token})` }}>
          <div className="obstruction-placing" role="status"><span>Placing {obsInfo(placingType).label.toLowerCase()}</span><small>Click a road on the map.</small></div>
          <button type="button" className="obstruction-cancel-btn" onClick={onCancelPlace}>Cancel</button>
        </div> : <p className="obstruction-help">Choose a type, then select a road.</p>}

        <div className="obstruction-panel-list">
          <div className="obstruction-list-title">
            <span>Active on map</span><span className="obstruction-count">{obstructions.length}</span>
          </div>
          {obstructions.length === 0 ? (
            <div className="obstruction-list-empty"><span>No active obstructions</span><small>New obstructions will appear here.</small></div>
          ) : (
            <div className="obstruction-list-scroll">
              {obstructions.map((o) => {
                const info = obsInfo(o.type);
                return (
                  <div key={o.id} className="obstruction-list-item">
                    <span
                      className="obstruction-chip-icon obstruction-item-icon"
                      style={{ "--obs": `var(${info.token})` }}
                    >
                      <ObstructionGlyph type={o.type} size={14} />
                    </span>
                    <span className="obstruction-item-copy">
                      <span className="obstruction-item-name" title={o.description || info.label}>{o.description || info.label}</span>
                      <small>{info.label}<span aria-hidden="true"> / </span>{info.blocks ? "Closed road" : "Delay"}</small>
                    </span>
                    <button
                      type="button"
                      className="obstruction-item-remove"
                      onClick={() => onDelete(o.id)}
                      title="Remove obstruction"
                      aria-label={`Remove ${o.description || `${info.label} ${o.id}`}`}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CloseIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function ConstraintEditorPanel({ data, loadError, onRetry, editing, onToggleEdit, blocked }) {
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button" className="constraint-float-btn" onClick={() => setOpen(true)} aria-label="Expand GAT constraints" aria-expanded={false}><PanelToggleIcon />GAT constraints</button>;
  return <section className="constraint-editor" aria-label="GAT constraints">
    <div className="constraint-editor-head"><button type="button" className="constraint-collapse-btn" onClick={() => setOpen(false)} aria-label="Collapse GAT constraints" aria-expanded={true}><PanelToggleIcon expanded /></button><span className="constraint-editor-title">GAT constraints</span></div>
    <div className="constraint-editor-body">
      {data ? <GnnLegend data={data} /> : <div className="constraint-load-state" role="status"><span>{loadError ? 'Could not load road constraints.' : 'Loading road constraints...'}</span>{loadError && <button type="button" onClick={onRetry}>Retry</button>}</div>}
      <button type="button" className="constraint-draw-btn" style={{ '--constraint-color': 'var(--accent-fire)' }} disabled={blocked || (!data && !editing)} aria-pressed={editing} onClick={onToggleEdit}>{editing ? 'Done editing' : 'Edit constraints'}</button>
      <p className="constraint-help">{editing ? 'Select roads on the map, then confirm and save.' : 'Enter editing mode to select roads and review saved edges.'}</p>
    </div>
  </section>;
}

function personnelStatusColor(status) {
  if (status === "dispatched")
    return { color: "var(--accent-amber)", shadow: "rgba(255,176,32,0.5)" };
  if (status === "onscene")
    return { color: "var(--accent-fire)", shadow: "rgba(255,77,26,0.5)" };
  return { color: "var(--accent-green)", shadow: "rgba(0,230,118,0.5)" };
}

// Splits a [lat, lon] polyline at the point nearest `pt` ([lat, lon]) so the
// dispatcher can see truck progress: the part behind the truck (traveled) and
// the part still ahead (remaining). Projection is done in a local planar frame
// (metres) — accurate at city scale. Mirrors the mobile updateRouteProgress
// guard: if the truck is more than 60 m from the line (off route) the whole
// path is returned as `remaining` so it stays fully visible until they rejoin.
function splitRouteAtPoint(line, pt) {
  if (!line || line.length < 2 || !pt) {
    return { traveled: [], remaining: line || [] };
  }
  const D2R = Math.PI / 180;
  const lat0 = pt[0] * D2R;
  const mx = (lon) => lon * D2R * Math.cos(lat0) * 6371000;
  const my = (lat) => lat * D2R * 6371000;
  const px = mx(pt[1]);
  const py = my(pt[0]);

  let best = { i: 0, point: line[0], d: Infinity };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const ax = mx(a[1]);
    const ay = my(a[0]);
    const dx = mx(b[1]) - ax;
    const dy = my(b[0]) - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const ex = px - (ax + dx * t);
    const ey = py - (ay + dy * t);
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best.d) {
      const point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      best = { i, point, d };
    }
  }

  if (best.d > 60) return { traveled: [], remaining: line };
  return {
    traveled: [...line.slice(0, best.i + 1), best.point],
    remaining: [best.point, ...line.slice(best.i + 1)],
  };
}

// Picks the live location for a dispatch that is furthest along the route, so a
// multi-person crew on one truck trims from the lead position rather than a
// straggler. Returns the [lat, lon] to split at, or null when none is on route.
// Stale positions are ignored — an outdated fix (e.g. a crew that was already
// near the incident) shouldn't trim the route; it falls back to the full
// station→incident line instead.
function truckProgressPoint(line, dispatchId, liveLocations) {
  const candidates = liveLocations.filter(
    (p) =>
      p.dispatch_id === dispatchId &&
      !p.is_stale &&
      p.latitude != null &&
      p.longitude != null
  );
  if (!candidates.length) return null;

  let best = null;
  for (const p of candidates) {
    const pt = [p.latitude, p.longitude];
    const { traveled } = splitRouteAtPoint(line, pt);
    if (!best || traveled.length > best.progress) {
      best = { pt, progress: traveled.length };
    }
  }
  // progress <= 1 means no segment was consumed (truck off route / at start).
  return best && best.progress > 1 ? best.pt : null;
}

export default function MapArea({
  cameraControlsHost = null,
  layerToolsHost = null,
  heatmapRevision = 0,
  pickingMode = false,
  onLocationPicked,
  pickedLocation,
  onLogIncidentHere,
  activeIncidents = [],
  newIncidents = [],
  reporterLocations = [],
  stations = [],
  personnel = [],
  livePersonnelLocations = [],
  dispatchRoutes = [],
  dispatches = [],
  focusedIncidentId = null,
  ripplingIncidentId = null,
  onIncidentClick,
  onViewStation,
  leftCollapsed = false,
  viewMode = "normal",
  constraintEditing = false,
  onConstraintEditingChange = () => {},
  layerPrefs = null,
  focusedPersonnel = null,
  mapFocus = null,
}) {
  const leftOffset = leftCollapsed ? 52 + 12 : 280 + 12;
  // Read once: Leaflet takes these as constructor options, and reading during
  // render rather than in state would be an impure call.
  const [mapMotion] = useState(
    () => document.documentElement.dataset.motion !== "off"
  );
  const activeLayers = useMemo(() => activeLayersFor(viewMode, layerPrefs), [viewMode, layerPrefs]);
  const constraintsView = activeLayers.has("GNN Constraints");
  const theme = useTheme();
  const [selectedBasemap, setSelectedBasemap] = useState(() => {
    const saved = readCommandBasemap();
    // Satellite is now a temporary fallback, rather than a saved style choice.
    return saved === "satellite" ? null : saved;
  });
  // Follow the app theme until the user explicitly chooses a basemap.
  const tileMode = selectedBasemap ?? (theme === "light" ? "street" : "dark");
  const isGoogle3D = tileMode === "google-3d";
  const [googleHost, setGoogleHost] = useState(null);
  const [rasterHost, setRasterHost] = useState(null);
  const [googleVisited, setGoogleVisited] = useState(isGoogle3D);
  const [rasterVisited, setRasterVisited] = useState(!isGoogle3D);
  const [rasterFallback, setRasterFallback] = useState(false);
  function changeBasemap(value) {
    // Road snapping relies on Leaflet pointer coordinates; leave placement
    // mode when entering 3D. Starting placement below returns to a street map.
    if (value === "google-3d") { setPlacingType(null); setGoogleVisited(true); }
    else setRasterVisited(true);
    setSelectedBasemap(value);
    saveCommandBasemap(value);
  }
  const heatmapActive = activeLayers.has("Heat Map");
  const heatmap = useHeatmap(heatmapActive, heatmapRevision);
  const [heatRange, setHeatRange] = useState({ from: "", to: "" });
  const heatPoints = useMemo(() => filterHeatmapPoints(heatmap.points, heatRange), [heatmap.points, heatRange]);
  const heatSurface = useMemo(() => heatmapActive ? heatmapSurface(heatPoints) : EMPTY_HEATMAP, [heatmapActive, heatPoints]);

  // ── GNN constraints ────────────────────────────────────────────────────────
  const [gnnData, setGnnData] = useState(null);
  const [gnnError, setGnnError] = useState(null);
  const [gnnAttempt, setGnnAttempt] = useState(0);

  useEffect(() => {
    const refreshModel = () => { setGnnData(null); setGnnError(null); setGnnAttempt(value => value + 1); };
    window.addEventListener('firetrackr:model-routing', refreshModel);
    return () => window.removeEventListener('firetrackr:model-routing', refreshModel);
  }, []);

  useEffect(() => {
    if (!activeLayers.has("GNN Constraints") || gnnData) return;
    let alive = true;
    fetchGnnConstraints()
      .then((data) => { if (alive) { setGnnData(data); setGnnError(null); } })
      .catch((err) => { if (alive) { setGnnError(err); console.error("GNN constraints fetch failed:", err); } });
    return () => { alive = false; };
  }, [activeLayers, gnnData, gnnAttempt]);

  // ── Custom road-edge constraints ──────────────────────────────────────────
  const [customConstraints, setCustomConstraints] = useState([]);
  const [selectionType, setSelectionType] = useState(null); // "narrow_road" | "traffic_area" | null
  const [selectedEdges, setSelectedEdges] = useState([]); // authoritative edge IDs
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [roadCatalog, setRoadCatalog] = useState(null);
  const [roadError, setRoadError] = useState('');
  const [hiddenConstraints, setHiddenConstraints] = useState(new Set());
  const [selectedConstraint, setSelectedConstraint] = useState(null);
  const [constraintNotice, setConstraintNotice] = useState('');
  const [constraintError, setConstraintError] = useState('');
  const [exitConstraintMode, setExitConstraintMode] = useState(false);
  function cancelConstraintDraft() {
    setSelectionType(null); setSelectedEdges([]); setShowSaveDialog(false);
  }
  function finishConstraintMode() {
    cancelConstraintDraft(); setSelectedConstraint(null); setHiddenConstraints(new Set());
    setExitConstraintMode(false); onConstraintEditingChange(false);
  }
  function toggleConstraintMode() {
    if (showSaveDialog) return;
    if (!constraintEditing) {
      onConstraintEditingChange(true);
      if (isGoogle3D) changeBasemap(theme === 'light' ? 'street' : 'dark');
    } else if (selectionType && selectedEdges.length) setExitConstraintMode(true);
    else finishConstraintMode();
  }

  useEffect(() => {
    if (!activeLayers.has("GNN Constraints")) return;
    let alive = true;
    fetchConstraints()
      .then(rows => { if (alive) { setCustomConstraints(rows); setConstraintError(''); } })
      .catch(() => { if (alive) setConstraintError('Saved road constraints could not load. Retry before editing.'); });
    return () => { alive = false; };
  }, [activeLayers, gnnAttempt]);

  useEffect(() => {
    if (!constraintEditing) return;
    let alive = true;
    fetchConstraintRoadEdges().then(data => {
      if (alive) { setRoadCatalog(data); setRoadError(''); }
    }).catch(error => { if (alive) setRoadError(error.message); });
    return () => { alive = false; };
  }, [constraintEditing, gnnAttempt]);

  // Enter reviews selected roads; Escape cancels selection.
  useEffect(() => {
    if (!constraintEditing || !constraintsView || !selectionType || showSaveDialog) return;
    function handleKey(e) {
      if (e.target.closest?.("input, textarea, select, button, [contenteditable=true]")) return;
      if (e.key === "Enter" && selectedEdges.length > 0) {
        setShowSaveDialog(true);
      } else if (e.key === "Escape") {
        setSelectionType(null);
        setSelectedEdges([]);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [constraintEditing, constraintsView, selectionType, selectedEdges, showSaveDialog]);

  function handleEdgeToggle(uid) {
    if (!constraintEditing || !selectionType || showSaveDialog) return;
    if (selectedEdges.length >= 500 && !selectedEdges.includes(uid)) {
      setConstraintNotice('Save this selection before selecting more than 500 edges.'); return;
    }
    setSelectedEdges(previous => toggleRoadEdge(previous, uid));
    setConstraintNotice('');
  }

  async function handleSaveConstraint(fields) {
    const saved = await saveConstraintEdges({ constraint_type: selectionType, segment_uids: selectedEdges, ...fields });
    const ids = new Set(saved.constraints.map(row => row.id));
    setCustomConstraints(previous => [...saved.constraints, ...previous.filter(row => !ids.has(row.id))]);
    setConstraintNotice(`${saved.constraints.length} road edges saved. ${saved.routing_applied === false ? 'Routing refresh is pending.' : 'Routing has been updated.'}`);
    setGnnData(null);
    setGnnAttempt(value => value + 1);
    cancelConstraintDraft();
  }

  // Deleting changes what the router avoids, so both obstruction and
  // constraint deletes go through a confirmation first.
  const [pendingDelete, setPendingDelete] = useState(null); // { kind, item }

  function handleDeleteConstraint(id) {
    const item = customConstraints.find((c) => c.id === id);
    if (item) setPendingDelete({ kind: "constraint", item });
  }

  // Throws on failure so the confirmation shows the error and stays open.
  async function confirmDeleteConstraint(id) {
    await deleteConstraint(id);
    setCustomConstraints((prev) => prev.filter((c) => c.id !== id));
    setGnnData(null);
    setSelectedConstraint(null);
    setConstraintNotice('Road constraint removed. Baseline annotations remain available.');
    setGnnAttempt(value => value + 1);
  }

  const isSelecting = constraintEditing && constraintsView && !!selectionType && !showSaveDialog;
  const selectionColor =
    CONSTRAINT_TYPES.find((t) => t.id === selectionType)?.color || "#fff";

  // ── Road obstructions ──────────────────────────────────────────────────────
  const [obstructions, setObstructions] = useState([]);
  const [placingType, setPlacingType] = useState(null);
  const obstructionPlacementActive = !!placingType && !constraintsView;
  // The adder starts open; collapsing it leaves the pins and a way back.
  const [adderOpen, setAdderOpen] = useState(true);
  // Where the pending obstruction would land once snapped, or null when the
  // pointer is too far from any road for it to be placeable.
  const [ghost, setGhost] = useState(null);
  const snapAbort = useRef(null);
  const lastSnapAt = useRef(0);

  useEffect(() => {
    fetchObstructions()
      .then(setObstructions)
      .catch(() => {});
  }, []);

  // Snapping happens server-side (the client has no road network), so the
  // pointer is throttled and each request supersedes the one before it --
  // otherwise a fast drag queues dozens of round trips and the ghost lands on
  // whichever reply happens to arrive last.
  function handleObstructionHover(latlng) {
    if (!obstructionPlacementActive) return;
    if (latlng === null) {
      setGhost(null);
      return;
    }
    const now = Date.now();
    if (now - lastSnapAt.current < 90) return;
    lastSnapAt.current = now;

    snapAbort.current?.abort();
    const ctrl = new AbortController();
    snapAbort.current = ctrl;
    snapToRoad(latlng[0], latlng[1], ctrl.signal)
      .then(setGhost)
      .catch(() => {}); // aborted or offline: keep the last good ghost
  }

  // Leaving placement mode must clear the preview, however it was left.
  useEffect(() => {
    if (!placingType) {
      snapAbort.current?.abort();
      setGhost(null);
    }
  }, [placingType]);

  function handleObstructionPlace() {
    // Placement follows the ghost, not the raw click: what the dispatcher saw
    // previewed is exactly what gets saved. No ghost means no road in range,
    // and the banner is already saying so.
    if (!obstructionPlacementActive || !ghost) return;
    const temp = {
      id: `local-${Date.now()}`,
      type: placingType,
      latitude: ghost.latitude,
      longitude: ghost.longitude,
      bearing_deg: ghost.bearing_deg,
      description: "",
      created_at: new Date().toISOString(),
    };
    setObstructions((prev) => [...prev, temp]);
    createObstruction({
      type: placingType,
      latitude: ghost.latitude,
      longitude: ghost.longitude,
    })
      .then((saved) => {
        setObstructions((prev) =>
          prev.map((o) => (o.id === temp.id ? { ...temp, ...saved } : o))
        );
      })
      .catch(() => {
        // The save failed, so drop the optimistic marker rather than leaving a
        // phantom obstruction that the router knows nothing about.
        setObstructions((prev) => prev.filter((o) => o.id !== temp.id));
      });
    setPlacingType(null);
  }

  function handleObstructionDelete(id) {
    const item = obstructions.find((o) => o.id === id);
    if (item) setPendingDelete({ kind: "obstruction", item });
  }

  // Waits for the server before dropping the marker: the old optimistic
  // removal swallowed failures, leaving an obstruction the router still
  // avoided but the map no longer showed.
  async function confirmDeleteObstruction(id) {
    // Still saving (local id): nothing on the server to delete yet.
    if (!String(id).startsWith("local-")) await deleteObstruction(id);
    setObstructions((prev) => prev.filter((o) => o.id !== id));
  }

  // Briefly raise the z-index of a personnel marker whenever its live
  // location changes, so the updated marker pops above its neighbors.
  // Leaflet paints on a canvas, so obstruction colours have to be resolved
  // from their tokens in JS and re-resolved whenever the theme flips.
  const obsColors = useMemo(
    () =>
      Object.fromEntries(
        OBSTRUCTION_TYPES.map((t) => [t.id, readCssVar(t.token, t.fallback)])
      ),
    // readCssVar reads off the DOM, so `theme` is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme]
  );

  const [mapZoom, setMapZoom] = useState(ZOOM);
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState(() => new Set());
  const prevLiveRef = useRef(new Map());
  useEffect(() => {
    const prev = prevLiveRef.current;
    const changed = [];
    for (const p of livePersonnelLocations) {
      const prior = prev.get(p.per_id);
      if (
        !prior ||
        prior.latitude !== p.latitude ||
        prior.longitude !== p.longitude
      ) {
        changed.push(p.per_id);
      }
    }
    prevLiveRef.current = new Map(
      livePersonnelLocations.map((p) => [p.per_id, p])
    );
    if (changed.length === 0) return;
    setRecentlyUpdatedIds((s) => {
      const next = new Set(s);
      changed.forEach((id) => next.add(id));
      return next;
    });
    const timers = changed.map((id) =>
      setTimeout(() => {
        setRecentlyUpdatedIds((s) => {
          if (!s.has(id)) return s;
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, 2500)
    );
    return () => timers.forEach(clearTimeout);
  }, [livePersonnelLocations]);

  // ── Barangay boundaries ────────────────────────────────────────────────────
  const [barangays, setBarangays] = useState(null);
  const [barangayError, setBarangayError] = useState(false);
  const [barangayAttempt, setBarangayAttempt] = useState(0);
  useEffect(() => {
    if ((!activeLayers.has("Barangay") && !constraintEditing) || barangays) return;
    fetchBarangays()
      .then(data => { setBarangays(data); setBarangayError(false); })
      .catch(() => setBarangayError(true));
  }, [activeLayers, barangays, constraintEditing, barangayAttempt]);

  const constraintLayers = useMemo(() => buildConstraintLayers(gnnData, customConstraints, barangays), [gnnData, customConstraints, barangays]);
  const selectedLayer = constraintLayers.find(row => row.key === selectedConstraint?.key);
  const visibleGnnData = useMemo(() => {
    if (!activeLayers.has('GNN Constraints')) return null;
    if (!gnnData) return gnnData;
    return { ...gnnData, constraints: { ...gnnData.constraints, features: gnnData.constraints.features
      .filter(feature => !constraintEditing || !hiddenConstraints.has(constraintLayerId(feature)))
      .map(feature => {
        const props = feature.properties;
        const focused = constraintEditing && constraintLayerId(feature) === selectedConstraint?.key;
        if (!props.custom && !focused) return feature;
        return { ...feature, properties: { ...props,
          map_color: props.custom ? roadConstraintColor(props.routing_constraint_type || props.display_constraint_type) : props.map_color,
          ...(focused ? { map_weight: 8, map_opacity: 1 } : {}),
        } };
      }) } };
  }, [activeLayers, constraintEditing, gnnData, hiddenConstraints, selectedConstraint]);

  // Only data/theme changes reconcile operational overlays. Camera readout
  // updates stay inside the renderer and never trigger a whole-layer scan.
  const overlayRevision = useMemo(() => ({}), [
    activeIncidents, newIncidents, reporterLocations, stations, personnel,
    livePersonnelLocations, dispatchRoutes, dispatches, focusedIncidentId,
    ripplingIncidentId, pickedLocation, ghost, obstructions, barangays, theme,
    selectedEdges, isSelecting, customConstraints, mapZoom, recentlyUpdatedIds, activeLayers, visibleGnnData,
  ]);

  return (
    <div className={`map-area${constraintEditing ? " map-area--constraint-editing" : ""}${isGoogle3D || !rasterFallback ? " map-area--projected" : ""}${isGoogle3D ? " map-area--3d" : ""}`}>
      <div ref={setGoogleHost} className="command-renderer-host" hidden={!isGoogle3D} />
      <div ref={setRasterHost} className="command-renderer-host" hidden={isGoogle3D || rasterFallback} />
      {/* Outside Leaflet so choosing a style never places a marker/drawing point. */}
      <CommandBasemapSelector value={tileMode} onChange={changeBasemap} editing={constraintEditing} />
      {/* Picking-mode banner */}
      {pickingMode && (
        <div className="map-pick-banner">
          {pickedLocation
            ? `${pickedLocation[0].toFixed(4)}, ${pickedLocation[1].toFixed(
                4
              )}  ·  Click elsewhere to reposition`
            : "Click on the map to mark the Incident location  -  ESC to cancel"}
        </div>
      )}

      {isSelecting && !pickingMode && <div className="map-pick-banner constraint-draw-banner" style={{ borderColor: selectionColor }}>
        {CONSTRAINT_TYPES.find(t => t.id === selectionType)?.label} / {selectedEdges.length} selected / Click a road to select or deselect
      </div>}

      {/* Obstruction placement banner */}
      {obstructionPlacementActive && !pickingMode && (
        <div
          className="map-pick-banner obstruction-banner"
          style={{ "--obs": `var(${obsInfo(placingType).token})` }}
        >
          <ObstructionGlyph type={placingType} size={13} />
          {ghost
            ? `Click to place ${obsInfo(placingType).label.toLowerCase()}`
            : "Move closer to a road \u2014 obstructions must sit on the network"}
          {"  ·  "}
          <span className="banner-action" onClick={() => setPlacingType(null)}>
            Cancel
          </span>
        </div>
      )}

      <MapContainer
        center={MAP_CENTER}
        zoom={ZOOM}
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
        attributionControl={false}
        /* Leaflet's motion is switched off through its own API rather than by
           overriding its CSS — see the data-motion note in index.css. These are
           constructor options, so they are read once per mount; MapArea
           unmounts while Settings is open, so a change there lands on return. */
        zoomAnimation={mapMotion}
        fadeAnimation={mapMotion}
        markerZoomAnimation={mapMotion}
      >
        {rasterFallback && !isGoogle3D && tileLayersFor(tileMode).map((layer, index) => (
          <TileLayer key={`${tileMode}-${index}`} {...layer} />
        ))}
        {rasterFallback && !isGoogle3D && <AttributionControl position="bottomleft" />}

        {/* Picking-mode handlers */}
        <MapClickHandler
          active={pickingMode}
          onPick={onLocationPicked}
          obstructionActive={obstructionPlacementActive}
          onObstructionPick={handleObstructionPlace}
          onObstructionHover={handleObstructionHover}
        />

        <CursorController active={pickingMode || obstructionPlacementActive || isSelecting} />
        <MapResizeWatcher />

        <PersonnelFocuser
          focusedPersonnel={focusedPersonnel}
          livePersonnelLocations={livePersonnelLocations}
        />
        <MapFocuser mapFocus={constraintEditing && selectedConstraint ? selectedConstraint.focus : mapFocus} />

        {constraintEditing && roadCatalog && <RoadEdgeSelector catalog={roadCatalog} selected={selectedEdges}
          active={isSelecting} color={selectionColor} onToggle={handleEdgeToggle} onMiss={setConstraintNotice} />}

        {/* Coverage mask + jurisdiction boundary */}
        <CoverageLayers />
        {rasterFallback && heatmapActive && <HeatmapLayer data={heatSurface} />}
        {heatmapActive && <HeatmapIncidents points={heatPoints} />}
        {rasterFallback && activeLayers.has("GNN Constraints") && gnnData && (
          <GnnConstraintsLayer data={visibleGnnData} />
        )}

        {/* Barangay boundary overlay with centered labels */}
        {activeLayers.has("Barangay") && barangays && (
          <BarangayLayer
            featureCollection={barangays}
            showLabels={mapZoom >= BARANGAY_LABEL_MIN_ZOOM}
          />
        )}

        {/* Branch paths — a deviated responder's own optimal path to the fire,
            trimmed by the backend where it converges onto the dispatch route so
            it reads as a branch off the main line rather than a second full
            route. Held at amber and a lower opacity so it stays subordinate to
            the route rather than competing with it — the route's own colour
            would collide, since a non-GNN route is dashed 8 5 too. The solid
            main route carries on from the merge dot; a path that never
            converges stays dashed all the way to the incident.
            Rendered BEFORE dispatch routes so the route always paints on top.
            Only render for personnel dispatched to the focused incident,
            mirroring the dispatch-route visibility rules. */}
        {activeLayers.has("Personnel") &&
          (() => {
            const focusedDispatchIds =
              focusedIncidentId != null
                ? new Set(
                    dispatches
                      .filter((d) => d.fire_id === focusedIncidentId)
                      .map((d) => d.dispatch_id)
                  )
                : null;

            const BRANCH_COLOR = "#ffb020";

            return livePersonnelLocations
              .filter(
                (p) =>
                  p.is_deviated &&
                  p.connector_geojson?.coordinates?.length >= 2 &&
                  (focusedDispatchIds === null ||
                    focusedDispatchIds.has(p.dispatch_id))
              )
              .map((p) => {
                const positions = p.connector_geojson.coordinates.map(
                  ([lon, lat]) => [lat, lon]
                );
                const merges = p.connector_geojson.merges === true;
                const mergePt = p.connector_geojson.merge_point;

                return (
                  <Fragment key={`branch-${p.per_id}`}>
                    <Polyline
                      positions={positions}
                      pathOptions={{
                        color: BRANCH_COLOR,
                        weight: 3,
                        dashArray: "8 5",
                        opacity: 0.6,
                      }}
                    >
                      <Tooltip sticky className="leaflet-dark-tooltip">
                        <div className="tooltip-id">Branch · {p.name}</div>
                        <div className="tooltip-sub">
                          {merges
                            ? "Own path — merges into the dispatch route"
                            : "Own path — independent approach to the incident"}
                        </div>
                      </Tooltip>
                    </Polyline>
                    {merges && mergePt && (
                      <CircleMarker
                        center={[mergePt[1], mergePt[0]]}
                        radius={4}
                        pathOptions={{
                          color: BRANCH_COLOR,
                          weight: 2,
                          fillColor: BRANCH_COLOR,
                          fillOpacity: 0.75,
                          opacity: 0.75,
                        }}
                      >
                        <Tooltip className="leaflet-dark-tooltip">
                          <div className="tooltip-id">Merge point</div>
                          <div className="tooltip-sub">
                            {p.name} joins the dispatch route here
                          </div>
                        </Tooltip>
                      </CircleMarker>
                    )}
                  </Fragment>
                );
              });
          })()}

        {/* Dispatch routes — only show routes for the selected incident.
            Selected route gets a palette color; alternatives render in gray behind it. */}
        {activeLayers.has("Routes") &&
          (() => {
            const ROUTE_COLORS = [
              "#22c55e",
              "#38bdf8",
              "#f472b6",
              "#a78bfa",
              "#fb923c",
              "#34d399",
              "#facc15",
              "#60a5fa",
            ];
            const visible =
              focusedIncidentId != null
                ? dispatchRoutes.filter((r) => r.fire_id === focusedIncidentId)
                : dispatchRoutes;

            // Unique dispatch IDs in original order for color assignment
            const dispatchIds = [
              ...new Set(dispatchRoutes.map((r) => r.dispatch_id)),
            ];

            // Map fire_id → incident so a route matches its incident-pin color
            const incById = new Map(activeIncidents.map((i) => [i.fire_id, i]));

            // Alternatives first so selected paints on top
            const sorted = [...visible].sort((a, b) =>
              a.isSelected === b.isSelected ? 0 : a.isSelected ? 1 : -1
            );

            return sorted.map((dr) => {
              // Route color matches its incident's pin (by severity); fall back
              // to the palette if the incident isn't in the active list.
              const inc = incById.get(dr.fire_id);
              const colorIdx = dispatchIds.indexOf(dr.dispatch_id);
              const color = inc
                ? severityColor(inc)
                : ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
              const isAlt = !dr.isSelected;

              const mainStyle = dr.isGnn
                ? { color, weight: 5, opacity: 0.8 }
                : { color, weight: 4, dashArray: "8 5", opacity: 0.8 };

              const tooltip = (
                <Tooltip sticky className="leaflet-dark-tooltip">
                  <div className="tooltip-id">
                    {isAlt
                      ? `Alt Route (Rank ${dr.rank})`
                      : dr.isGnn
                      ? "GNN Route"
                      : "Dispatch Route"}
                  </div>
                  <div className="tooltip-sub">{dr.teamName}</div>
                  {dr.etaMinutes && (
                    <div className="tooltip-sub">ETA ~{dr.etaMinutes} min</div>
                  )}
                </Tooltip>
              );

              // Alternatives are not being driven — always show the full path.
              if (isAlt) {
                return (
                  <Polyline
                    key={dr.id}
                    positions={dr.positions}
                    pathOptions={{ color: "#888", weight: 2, opacity: 0.5 }}
                  >
                    {tooltip}
                  </Polyline>
                );
              }

              // Selected route: trim at the truck's live position so the line
              // shrinks as the crew makes progress. Traveled part stays as a
              // faint ghost for context; remaining part keeps the full style.
              const truckPt = truckProgressPoint(
                dr.positions,
                dr.dispatch_id,
                livePersonnelLocations
              );
              const { traveled, remaining } = splitRouteAtPoint(
                dr.positions,
                truckPt
              );

              return (
                <Fragment key={dr.id}>
                  {traveled.length >= 2 && (
                    <Polyline
                      positions={traveled}
                      pathOptions={{
                        color,
                        weight: 3,
                        opacity: 0.25,
                        dashArray: "4 6",
                      }}
                    />
                  )}
                  <Polyline positions={remaining} pathOptions={mainStyle}>
                    {tooltip}
                  </Polyline>
                </Fragment>
              );
            });
          })()}

        {/* Fire stations */}
        {activeLayers.has("Stations") &&
          stations
            .filter((s) => s.station_latitude && s.station_longitude)
            .map((s) => (
              <StationMapMarker
                key={s.station_id}
                station={s}
                icon={stationIcon()}
                onViewStation={onViewStation}
              />
            ))}

        {/* Incident markers — live (active / en route / contained) */}
        {activeLayers.has("Incidents") &&
          activeIncidents.map((inc) => (
            <Marker
              key={`${inc.fire_id}-${inc.fire_id === ripplingIncidentId}`}
              hoverOnly={true}
              position={[inc.latitude, inc.longitude]}
              icon={fireIcon(
                toIconSeverity(inc),
                inc.fire_id === ripplingIncidentId
              )}
              eventHandlers={{
                click: (event) => { event.target.closeTooltip(); onIncidentClick?.(inc.id); },
              }}
            >
              <Tooltip direction="top" className="command-map-tooltip" opacity={1}>
                <IncidentMapTooltip id={inc.id} status={inc.status} location={inc.loc}
                  severity={inc.sev} alarm={inc.alarm} units={inc.units} />
              </Tooltip>
            </Marker>
          ))}

        <ZoomTracker onZoom={setMapZoom} />

        {/* Personnel markers — prefer live locations from polling; fall back to personnel list */}
        {activeLayers.has("Personnel") &&
          mapZoom >= PERSONNEL_MIN_ZOOM &&
          (() => {
            // Build a lookup from per_id → live location entry
            const liveById = Object.fromEntries(
              livePersonnelLocations.map((p) => [p.per_id, p])
            );

            return personnel
              .map((p) => {
                const live = liveById[p.per_id];
                // Don't render personnel whose last known location is older
                // than 8 hours — treat them as no longer on the map.
                if (
                  live?.age_minutes != null &&
                  live.age_minutes >= PERSONNEL_STALE_HIDE_MINUTES
                ) {
                  return null;
                }
                const lat = live?.latitude ?? p.latitude;
                const lon = live?.longitude ?? p.longitude;
                if (!lat || !lon) return null;
                const { color, shadow } = personnelStatusColor(p.status);
                const deviated = live?.is_deviated ?? false;
                const stale = live?.is_stale ?? false;
                const ageText = live ? `${live.age_minutes} min ago` : null;
                return (
                  <Marker
                    key={p.per_id}
                    position={[lat, lon]}
                    icon={personnelIcon(
                      p.initials,
                      stale ? "#555" : color,
                      stale ? "rgba(80,80,80,0.3)" : shadow,
                      deviated
                    )}
                    zIndexOffset={recentlyUpdatedIds.has(p.per_id) ? 1000 : 0}
                  >
                    <Tooltip direction="top" className="leaflet-dark-tooltip">
                      <div className="tooltip-id">
                        {p.name} · {p.rank}
                        {deviated ? " · ⚠ Off Route" : ""}
                      </div>
                      <div className="tooltip-sub">{p.station}</div>
                      {ageText && (
                        <div
                          className="tooltip-sub"
                          style={stale ? { color: "#ff6b6b" } : {}}
                        >
                          Last seen {ageText}
                          {stale ? " (stale)" : ""}
                        </div>
                      )}
                    </Tooltip>
                  </Marker>
                );
              })
              .filter(Boolean);
          })()}

        {/* Newly logged incidents */}
        {!constraintsView && newIncidents.map((inc) => (
          <Marker
            key={inc.id}
            hoverOnly={true}
            position={inc.coords}
            icon={fireIcon(inc.severity || "critical", false, true)}
            eventHandlers={{
              click: (event) => { event.target.closeTooltip(); onIncidentClick?.(inc.id); },
            }}
          >
            <Tooltip direction="top" className="command-map-tooltip" opacity={1}>
              <IncidentMapTooltip id={inc.id} status="New" location={inc.locationName}
                severity={inc.severity} alarm={inc.alarm} />
            </Tooltip>
          </Marker>
        ))}

        {/* Reporter location markers */}
        {!constraintsView && reporterLocations.map((r) => (
          <Marker key={r.token} position={r.coords} icon={reporterIcon()}>
            <Tooltip direction="top" className="leaflet-dark-tooltip">
              <div className="tooltip-id request-token">{r.token}</div>
              <div className="tooltip-name">Reporter Location</div>
              <div className="tooltip-sub">
                {r.coords[0].toFixed(5)}, {r.coords[1].toFixed(5)}
              </div>
              <div className="tooltip-sub">Click to log incident</div>
            </Tooltip>
            <Popup className="reporter-popup">
              <div className="reporter-popup-inner">
                <div className="reporter-popup-header">
                  {/* <span>📱</span> */}
                  <strong>Reporter Location</strong>
                </div>
                <div className="reporter-popup-coords">
                  {r.coords[0].toFixed(5)}, {r.coords[1].toFixed(5)}
                </div>
                {r.mobile && (
                  <div className="reporter-popup-phone">{r.mobile}</div>
                )}
                <button
                  className="reporter-log-btn"
                  onClick={() => onLogIncidentHere?.(r.coords, r.mobile, r.token)}
                >
                  Log Incident
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Picked location preview pin */}
        {!constraintsView && pickedLocation && (
          <Marker position={pickedLocation} icon={newIncidentIcon()} />
        )}

        {/* Ghost preview of the pending obstruction, on its snapped position */}
        {obstructionPlacementActive && ghost && (
          <Marker
            position={[ghost.latitude, ghost.longitude]}
            icon={obstructionGhostIcon(placingType)}
            mapAligned={true}
            interactive={false}
            zIndexOffset={500}
          />
        )}

        {/* Outside the obstruction view an obstruction is a bar across the
            road, not a pin: it stays legible without competing with the
            incident and unit markers that view is actually about. */}
        {!constraintsView && viewMode !== "obstructions" &&
          obstructions.map((obs) => {
            const bar = obstructionBar(obs);
            if (!bar) return null;
            const info = obsInfo(obs.type);
            return (
              <Polyline
                key={`bar-${obs.id}`}
                positions={bar}
                pathOptions={{
                  color: obsColors[obs.type],
                  weight: 6,
                  opacity: 0.95,
                  lineCap: "butt",
                  // Dashed for the types traffic can still crawl through,
                  // solid for the ones that are genuinely shut.
                  dashArray: info.blocks ? null : "4 3",
                }}
              >
                <Tooltip direction="top" className="command-map-tooltip" opacity={1}>
                  <div className="command-tooltip-heading"><ObstructionGlyph type={obs.type} size={13} />{info.label}</div>
                  <div className="command-tooltip-divider">{info.effect}</div>
                </Tooltip>
              </Polyline>
            );
          })}

        {/* Road obstructions */}
        {viewMode === "obstructions" &&
          obstructions.map((obs) => {
            const info = obsInfo(obs.type);
            return (
              <Marker
                key={obs.id}
                position={[obs.latitude, obs.longitude]}
                icon={obstructionIcon(obs.type)}
                mapAligned={true}
              >
                <Popup className="obstruction-popup">
                  <div
                    className="obstruction-popup-inner"
                    style={{ "--obs": `var(${info.token})` }}
                  >
                    <div className="obstruction-popup-header">
                      <span className="obstruction-popup-icon">
                        <ObstructionGlyph type={obs.type} size={13} />
                      </span>
                      <strong>{info.label}</strong>
                    </div>
                    {/* What it does to routing, in the dispatcher's terms --
                        the reason they placed it in the first place. */}
                    <div
                      className={`obstruction-popup-effect${
                        info.blocks ? " obstruction-popup-effect--blocking" : ""
                      }`}
                    >
                      {info.effect}
                    </div>
                    <div className="obstruction-popup-coords">
                      {obs.latitude.toFixed(5)}, {obs.longitude.toFixed(5)}
                    </div>
                    {obs.description && (
                      <div className="obstruction-popup-desc">
                        {obs.description}
                      </div>
                    )}
                    <button
                      className="obstruction-remove-btn"
                      onClick={() => handleObstructionDelete(obs.id)}
                    >
                      Remove obstruction
                    </button>
                  </div>
                </Popup>
                <Tooltip direction="top" className="command-map-tooltip" opacity={1}>
                  <div className="command-tooltip-heading"><ObstructionGlyph type={obs.type} size={13} />{info.label}</div>
                  <div className="command-tooltip-divider">{info.effect}</div>
                </Tooltip>
              </Marker>
            );
          })}
        {googleVisited && (
          <GooglePhotorealisticMap
            portalHost={googleHost}
            controlsHost={cameraControlsHost}
            active={isGoogle3D}
            onFallback={() => {
              setGoogleVisited(false);
              setRasterVisited(true);
              setSelectedBasemap("satellite");
            }}
            heatmapData={heatmapActive ? heatSurface : null}
            overlayRevision={overlayRevision}
            gnnData={visibleGnnData}
            barangayData={activeLayers.has("Barangay") ? barangays : null}
            showBarangayLabels={mapZoom >= BARANGAY_LABEL_MIN_ZOOM}
          />
        )}
        {rasterVisited && (
          <RasterCommandMap
            portalHost={rasterHost}
            controlsHost={cameraControlsHost}
            active={!isGoogle3D && !rasterFallback}
            tileMode={tileMode}
            overlayRevision={overlayRevision}
            gnnData={visibleGnnData}
            heatmapData={heatSurface}
            picking={pickingMode || obstructionPlacementActive || isSelecting}
            onUnavailable={() => setRasterFallback(true)}
          />
        )}
      </MapContainer>

      {constraintEditing && <ConstraintLayersPanel
        rows={constraintLayers} selectedKey={selectedLayer?.key} hidden={hiddenConstraints}
        onSelect={row => {
          setHiddenConstraints(previous => { const next = new Set(previous); next.delete(row.key); return next; });
          setSelectedConstraint({ key: row.key, focus: { lat: row.center[1], lng: row.center[0], bounds: row.coordinates.map(([lng, lat]) => [lat, lng]), zoom: 17, nonce: Date.now() } });
        }}
        onVisibility={key => setHiddenConstraints(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
        onExit={toggleConstraintMode} selectionType={selectionType} edgeCount={selectedEdges.length} locked={showSaveDialog} roadsReady={!!roadCatalog && !roadError && !constraintError}
        onStartSelection={type => { setSelectionType(type); setSelectedEdges([]); setConstraintNotice(''); }}
        onFinish={() => { if (selectedEdges.length) setShowSaveDialog(true); }}
        onCancel={cancelConstraintDraft} onDelete={handleDeleteConstraint}
        loading={!gnnData && !gnnError} error={roadError || constraintError || (gnnError ? 'Road constraints could not load.' : '')}
        onRetry={() => { setGnnAttempt(value => value + 1); setBarangayAttempt(value => value + 1); }}
        notice={constraintNotice} locationError={barangayError}
      />}
      {exitConstraintMode && <ConfirmModal title="Discard selected edges?" message="Your unsaved road selection will be discarded when you leave editing mode. Saved constraints remain unchanged." confirmLabel="Discard and exit" onConfirm={finishConstraintMode} onClose={() => setExitConstraintMode(false)} />}

      {/* Constraint save dialog */}
      {showSaveDialog && (
        <ConstraintEdgeSaveDialog
          constraintType={selectionType}
          edgeCount={selectedEdges.length}
          onSave={handleSaveConstraint}
          onCancel={() => setShowSaveDialog(false)}
        />
      )}

      {pendingDelete?.kind === "obstruction" && (() => {
        const o = pendingDelete.item;
        const info = obsInfo(o.type);
        return (
          <ConfirmModal
            eyebrow="REMOVE OBSTRUCTION"
            title={`Remove this ${info.label.toLowerCase()}?`}
            details={[
              { label: "Type", value: info.label },
              { label: "Effect", value: info.effect },
              ...(o.description ? [{ label: "Note", value: o.description }] : []),
              { label: "Location", value: `${o.latitude.toFixed(5)}, ${o.longitude.toFixed(5)}` },
            ]}
            message="New routes and reroutes will stop avoiding this spot. Routes already sent to crews don't change."
            confirmLabel="Remove"
            onConfirm={() => confirmDeleteObstruction(o.id)}
            onClose={() => setPendingDelete(null)}
          />
        );
      })()}

      {pendingDelete?.kind === "constraint" && (() => {
        const c = pendingDelete.item;
        const info = CONSTRAINT_TYPES.find((t) => t.id === c.constraint_type) || CONSTRAINT_TYPES[0];
        return (
          <ConfirmModal
            eyebrow="DELETE CONSTRAINT"
            title={`Delete ${c.name ? `"${c.name}"` : "this constraint"}?`}
            details={[
              { label: "Type", value: info.label },
              ...(c.name ? [{ label: "Name", value: c.name }] : []),
              ...(c.highway ? [{ label: "Road class", value: c.highway }] : []),
            ]}
            message="Remove this saved road constraint? Baseline constraints for the road will remain. The deletion is retained in annotation history."
            confirmLabel="Delete"
            onConfirm={() => confirmDeleteConstraint(c.id)}
            onClose={() => setPendingDelete(null)}
          />
        );
      })()}

      {/* Layer tools share the incident/camera dock so panels cannot overlap. */}
      {layerToolsHost && (constraintsView || heatmapActive || viewMode === "obstructions") && createPortal(
      <div className="command-map-tools">
        {activeLayers.has("GNN Constraints") ? (
          <ConstraintEditorPanel
            data={gnnData}
            loadError={gnnError}
            onRetry={() => { setGnnError(null); setGnnAttempt((v) => v + 1); }}
            editing={constraintEditing}
            blocked={showSaveDialog}
            onToggleEdit={toggleConstraintMode}
          />
        ) : viewMode === "obstructions" ? (
          <ObstructionPanel
            open={adderOpen}
            onToggleOpen={() => setAdderOpen((v) => !v)}
            placingType={placingType}
            onStartPlace={(type) => {
              if (isGoogle3D) changeBasemap(theme === "light" ? "street" : "dark");
              setPlacingType(type);
            }}
            onCancelPlace={() => setPlacingType(null)}
            obstructions={obstructions}
            onDelete={handleObstructionDelete}
          />
        ) : heatmapActive ? (
          <HeatmapPanel range={heatRange} onRangeChange={setHeatRange} count={heatPoints.length} status={heatmap.status} onRefresh={heatmap.refresh} />
        ) : null}
      </div>, layerToolsHost)}
    </div>
  );
}
