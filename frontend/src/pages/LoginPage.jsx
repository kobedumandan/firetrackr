import { useState } from "react";
import { apiFetch } from "../api";
import BackendStatus from "../components/BackendStatus";
import "../styles/LoginPage.css";

function EmailIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-meta-icon"
      fill="currentColor"
    >
      <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280L160-640v400h640v-400L480-440Zm0-80 320-200H160l320 200ZM160-640v-80 480-400Z" />
    </svg>
  );
}
function PasswordIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-meta-icon"
      fill="currentColor"
    >
      <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z" />
    </svg>
  );
}
function VisibilityOn() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="pw-toggle-icon"
      fill="currentColor"
    >
      <path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM214-281.5Q94-363 40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200q-146 0-266-81.5ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z" />
    </svg>
  );
}
function VisibilityOff() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="pw-toggle-icon"
      fill="currentColor"
    >
      <path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z" />
    </svg>
  );
}

function FeatureFireIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-feature-glyph"
      fill="currentColor"
    >
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg>
  );
}
function FeatureRoutingIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-feature-glyph"
      fill="currentColor"
    >
      <path d="M247-167q-47-47-47-113v-327q-35-13-57.5-43.5T120-720q0-50 35-85t85-35q50 0 85 35t35 85q0 39-22.5 69.5T280-607v327q0 33 23.5 56.5T360-200q33 0 56.5-23.5T440-280v-400q0-66 47-113t113-47q66 0 113 47t47 113v327q35 13 57.5 43.5T840-240q0 50-35 85t-85 35q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-327q0-33-23.5-56.5T600-760q-33 0-56.5 23.5T520-680v400q0 66-47 113t-113 47q-66 0-113-47Zm-7-513q17 0 28.5-11.5T280-720q0-17-11.5-28.5T240-760q-17 0-28.5 11.5T200-720q0 17 11.5 28.5T240-680Zm480 480q17 0 28.5-11.5T760-240q0-17-11.5-28.5T720-280q-17 0-28.5 11.5T680-240q0 17 11.5 28.5T720-200ZM240-720Zm480 480Z" />
    </svg>
  );
}
function FeatureTrackingIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-feature-glyph"
      fill="currentColor"
    >
      <path d="M440-42v-80q-125-14-214.5-103.5T122-440H42v-80h80q14-125 103.5-214.5T440-838v-80h80v80q125 14 214.5 103.5T838-520h80v80h-80q-14 125-103.5 214.5T520-122v80h-80Zm238-240q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82Zm-311-85q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47Zm169.5-56.5Q560-447 560-480t-23.5-56.5Q513-560 480-560t-56.5 23.5Q400-513 400-480t23.5 56.5Q447-400 480-400t56.5-23.5ZM480-480Z" />
    </svg>
  );
}
function FeatureTruckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-feature-glyph"
      fill="currentColor"
    >
      <path d="M195-155q-35-35-35-85h-40q-33 0-56.5-23.5T40-320v-200h440v-160q0-33 23.5-56.5T560-760h80v-40q0-17 11.5-28.5T680-840h40q17 0 28.5 11.5T760-800v40h22q26 0 47 15t29 40l58 172q2 6 3 12.5t1 13.5v267H800q0 50-35 85t-85 35q-50 0-85-35t-35-85H400q0 50-35 85t-85 35q-50 0-85-35Zm113.5-56.5Q320-223 320-240t-11.5-28.5Q297-280 280-280t-28.5 11.5Q240-257 240-240t11.5 28.5Q263-200 280-200t28.5-11.5Zm400 0Q720-223 720-240t-11.5-28.5Q697-280 680-280t-28.5 11.5Q640-257 640-240t11.5 28.5Q663-200 680-200t28.5-11.5ZM120-440v120h71q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h111v-120H120Zm440 120h31q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h71v-120H560v120Zm0-200h276l-54-160H560v160ZM40-560v-60h40v-80H40v-60h400v60h-40v80h40v60H40Zm100-60h70v-80h-70v80Zm130 0h70v-80h-70v80Zm210 180H120h360Zm80 0h280-280Z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="lp-alert-icon"
      fill="currentColor"
    >
      <path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
    </svg>
  );
}

// Hero routes, as grid points [col, row] on the 44px background grid. Each
// segment is horizontal or vertical so the route rides the grid lines.
const GRID = 44;
const ROUTES = [
  { pts: [[0, 6], [7, 6], [7, 11], [15, 11], [15, 4], [26, 4]], dur: 11, delay: 0 },
  { pts: [[30, 15], [19, 15], [19, 8], [11, 8], [11, 2], [3, 2], [3, 0]], dur: 14, delay: -5 },
  { pts: [[2, 26], [2, 17], [13, 17], [13, 13], [26, 13]], dur: 10, delay: -3 },
  { pts: [[22, 0], [22, 6], [17, 6], [17, 20], [30, 20]], dur: 13, delay: -8 },
];

// Grid lines are 1px wide at 44k-1 (background-position: -1px), so their
// centre is 44k-0.5.
const toXY = ([c, r]) => [c * GRID - 0.5, r * GRID - 0.5];

function HeroRoutes() {
  return (
    <svg className="lp-hero-routes lp-hero-layer" aria-hidden="true">
      {ROUTES.map((route, i) => {
        const d = route.pts
          .map((p, j) => `${j ? "L" : "M"}${toXY(p).join(" ")}`)
          .join(" ");
        const [ex, ey] = toXY(route.pts[route.pts.length - 1]);
        return (
          <g key={i}>
            <path className="lp-route-base" d={d} />
            <path
              className="lp-route-pulse"
              d={d}
              pathLength="100"
              style={{ "--dur": `${route.dur}s`, "--delay": `${route.delay}s` }}
            />
            <rect className="lp-route-node" x={ex - 2} y={ey - 2} width="4" height="4" />
          </g>
        );
      })}
    </svg>
  );
}

const FEATURES = [
  {
    cls: "fi-fire",
    Icon: FeatureFireIcon,
    title: "Incident Management",
    desc: "Track active fires across every barangay, with live severity and alarm escalation.",
  },
  {
    cls: "fi-blue",
    Icon: FeatureRoutingIcon,
    title: "GNN-Weighted Routing",
    desc: "Response routes computed by a graph neural network over the city road network.",
  },
  {
    cls: "fi-green",
    Icon: FeatureTrackingIcon,
    title: "Personnel Tracking",
    desc: "Field units reported in real time through the FireTrackr mobile app.",
  },
  {
    cls: "fi-amber",
    Icon: FeatureTruckIcon,
    title: "Multi-Station Dispatch",
    desc: "Coordinate main and sub-station teams from one command dashboard.",
  },
];

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState("");
  const [errors, setErrors] = useState({ email: false, password: false });

  // Spotlight: write the cursor position straight onto the hero as CSS vars
  // (no re-render per move); the CSS transition on --mx/--my supplies the lag.
  // Clearing them on leave lets the glow drift back to its resting corner.
  // Every .lp-spot element gets the same point in its own coordinates
  // (--sx/--sy) so its rim light tracks the glow.
  function aimSpots(hero, clientX, clientY) {
    hero.querySelectorAll(".lp-spot").forEach((el) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--sx", `${clientX - r.left}px`);
      el.style.setProperty("--sy", `${clientY - r.top}px`);
    });
  }

  // The light enters from its resting corner, so start each rim there without
  // animating — otherwise it sweeps in from wherever it was last left.
  function handleHeroEnter(e) {
    if (e.pointerType !== "mouse") return;
    const hero = e.currentTarget;
    const h = hero.getBoundingClientRect();
    const spots = hero.querySelectorAll(".lp-spot");
    spots.forEach((el) => (el.style.transition = "none"));
    aimSpots(hero, h.right, h.bottom);
    spots.forEach((el) => {
      void el.offsetWidth;
      el.style.transition = "";
    });
  }

  function handleHeroMove(e) {
    if (e.pointerType !== "mouse") return;
    const hero = e.currentTarget;
    const r = hero.getBoundingClientRect();
    hero.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    hero.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    aimSpots(hero, e.clientX, e.clientY);
  }

  function handleHeroLeave(e) {
    const hero = e.currentTarget;
    const r = hero.getBoundingClientRect();
    hero.style.removeProperty("--mx");
    hero.style.removeProperty("--my");
    aimSpots(hero, r.right, r.bottom);
  }

  function validate() {
    const e = {
      email: !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      password: !password,
    };
    setErrors(e);
    return !e.email && !e.password;
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (loading) return;
    setAlert("");
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("bfp_token", data.access_token);
        localStorage.setItem("bfp_user", JSON.stringify(data.user));
        onLogin(data.user);
      } else if (res.status === 403) {
        setAlert("This account is for field personnel. Sign in with the FireTrackr mobile app instead.");
      } else if (res.status >= 500) {
        setAlert("The server is temporarily unavailable. Please wait and try again.");
      } else {
        setErrors({ email: true, password: true });
        setAlert("Invalid credentials. Please check your email and password.");
      }
    } catch {
      setAlert("Unable to reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="lp-body">
      <div className="lp-shell">
        {/* LEFT: HERO PANEL */}
        <section
          className="lp-hero"
          aria-label="About FireTrackr"
          onPointerEnter={handleHeroEnter}
          onPointerMove={handleHeroMove}
          onPointerLeave={handleHeroLeave}
        >
          <div className="lp-hero-glow lp-hero-layer" aria-hidden="true" />
          <HeroRoutes />

          <div className="lp-hero-top lp-rise" style={{ "--d": "0ms" }}>
            <div className="lp-brand">
              <div className="lp-brand-icon" />
              <div className="lp-brand-text">
                FIRE<span>TRACKR</span>
              </div>
            </div>
          </div>

          <div className="lp-hero-copy lp-rise" style={{ "--d": "80ms" }}>
            <h1 className="lp-headline">
              Command, route and dispatch <span>from one console.</span>
            </h1>
            <div className="lp-eyebrow lp-spot">
              Bureau of Fire Protection
              <span className="lp-separator" aria-hidden="true">|</span>
              Panabo City
            </div>
          </div>

          <ul className="lp-features">
            {FEATURES.map((f, i) => (
              <li
                className="lp-feature lp-spot lp-rise"
                key={f.title}
                style={{ "--d": `${160 + i * 60}ms` }}
              >
                <div className={`lp-feature-icon ${f.cls}`}>
                  <f.Icon />
                </div>
                <div className="lp-feature-title">{f.title}</div>
                <div className="lp-feature-desc">{f.desc}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* RIGHT: SIGN-IN */}
        <section className="lp-auth" aria-labelledby="lp-auth-title">
          <form
            className="lp-form lp-rise"
            style={{ "--d": "120ms" }}
            onSubmit={handleLogin}
            noValidate
          >
            <div className="lp-form-brand">
              <div className="lp-brand-icon sm" />
              <div className="lp-brand-text sm">
                FIRE<span>TRACKR</span>
              </div>
            </div>

            <div className="lp-form-head">
              <h2 id="lp-auth-title" className="lp-form-title">
                Sign in
              </h2>
              <p className="lp-form-sub">
                Use your dispatcher or administrator account.
              </p>
            </div>

            {alert && (
              <div className="lp-alert" role="alert">
                <AlertIcon />
                <span>{alert}</span>
              </div>
            )}

            <div className="lp-field-group">
              <label className="lp-field-label" htmlFor="lp-email">
                Email
              </label>
              <div className="lp-field-wrap">
                <EmailIcon />
                <input
                  id="lp-email"
                  className={`lp-field-input${errors.email ? " error" : ""}`}
                  type="email"
                  placeholder="you@bfp.gov.ph"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  aria-invalid={errors.email}
                  aria-describedby={errors.email ? "lp-email-err" : undefined}
                />
              </div>
              {errors.email && (
                <div id="lp-email-err" className="lp-field-error">
                  Please enter a valid email address.
                </div>
              )}
            </div>

            <div className="lp-field-group">
              <label className="lp-field-label" htmlFor="lp-password">
                Password
              </label>
              <div className="lp-field-wrap">
                <PasswordIcon />
                <input
                  id="lp-password"
                  className={`lp-field-input has-toggle${errors.password ? " error" : ""}`}
                  type={showPw ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  aria-invalid={errors.password}
                  aria-describedby={errors.password ? "lp-pw-err" : undefined}
                />
                <button
                  type="button"
                  className="lp-pw-toggle"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  aria-pressed={showPw}
                >
                  {showPw ? <VisibilityOn /> : <VisibilityOff />}
                </button>
              </div>
              {errors.password && (
                <div id="lp-pw-err" className="lp-field-error">
                  Password is required.
                </div>
              )}
            </div>

            <button
              type="submit"
              className={`lp-btn-login${loading ? " loading" : ""}`}
              disabled={loading}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <span className="lp-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>

            <BackendStatus />
          </form>

          <footer className="lp-footer">
            <div className="lp-copyright">
              © 2026 FireTrackr{" "}
              <span className="lp-separator" aria-hidden="true">|</span>{" "}
              All rights reserved.
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}
