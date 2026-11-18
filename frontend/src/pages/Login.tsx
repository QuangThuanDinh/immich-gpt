import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import { getOIDCStatus } from "../services/api";
import { formatApiError } from "../utils/apiError";
import BrandLogo from "../components/BrandLogo";
import styles from "./Login.module.css";

export default function Login() {
  const { user, loading } = useAuth();
  const [configured, setConfigured] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getOIDCStatus()
      .then(status => {
        if (!active) return;
        setConfigured(status.configured);
        if (!status.configured) setError("Configure the OIDC environment variables on the server before signing in.");
      })
      .catch(err => {
        if (active) setError(formatApiError(err, "Could not load OIDC configuration."));
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <BrandLogo variant="stacked" size="auth" className={styles.logoRow} />
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.label}>Use your private identity provider to sign in.</p>
        {error && <div className={styles.errorBox} role="alert">{error}</div>}
        <button
          type="button"
          className={styles.submitBtn}
          disabled={checking || !configured}
          onClick={() => { window.location.href = "/api/auth/oidc/login"; }}
        >
          {checking ? "Checking configuration..." : "Sign in with OIDC"}
        </button>
      </div>
    </div>
  );
}
