import { useState } from "react";
import "../styles/MapActions.css";
import PanelToggleIcon from "./PanelToggleIcon";

function LogIncIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="map-actions-icon"
      fill="currentColor"
    >
      <path d="M480-80Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880h20q10 0 20 2v81q-10-2-19.5-2.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186q122-112 181-203.5T720-552v-8h80v8q0 100-79.5 217.5T480-80Zm56.5-423.5Q560-527 560-560t-23.5-56.5Q513-640 480-640t-56.5 23.5Q400-593 400-560t23.5 56.5Q447-480 480-480t56.5-23.5ZM480-560Zm240-80h80v-120h120v-80H800v-120h-80v120H600v80h120v120Z" />
    </svg>
  );
}

function ReportIncIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="map-actions-icon"
      fill="currentColor"
    >
      <path d="M440-42v-80q-125-14-214.5-103.5T122-440H42v-80h80q14-125 103.5-214.5T440-838v-80h80v80q125 14 214.5 103.5T838-520h80v80h-80q-14 125-103.5 214.5T520-122v80h-80Zm238-240q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82Zm-311-85q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q560-447 560-480t-23.5-56.5Q513-560 480-560t-56.5 23.5Q400-513 400-480t23.5 56.5Q447-400 480-400t56.5-23.5ZM480-480Z" />
    </svg>
  );
}

export default function MapActions({
  pickingMode,
  onStartPicking,
  onOpenLocationRequest,
  reporterCount,
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        className="map-actions-float-btn"
        onClick={() => setCollapsed(false)}
        title="Expand actions"
      >
        <PanelToggleIcon />
        Actions
      </button>
    );
  }

  return (
    <div className="map-actions-panel">
      <div className="map-actions-header">
        <button
          className="map-actions-collapse-btn"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          <PanelToggleIcon expanded />
        </button>
        <div className="map-actions-section-header">
          Actions
        </div>
      </div>
      {pickingMode ? (
        <div className="map-actions-picking">
          <div className="map-actions-picking-dot" />
          <span>Picking Location</span>
        </div>
      ) : (
        <button className="map-actions-log-btn" onClick={onStartPicking}>
          <LogIncIcon />
          Log New Incident
        </button>
      )}
      <button
        className="map-actions-req-btn"
        onClick={onOpenLocationRequest}
        disabled={pickingMode}
      >
        <ReportIncIcon />
        Request Location
        {reporterCount > 0 && (
          <span className="map-actions-reporter-badge">{reporterCount}</span>
        )}
      </button>
    </div>
  );
}
