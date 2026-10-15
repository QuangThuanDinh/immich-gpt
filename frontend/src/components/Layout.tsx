import React, { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";
import SidebarContext from "../contexts/SidebarContext";
import { useJobCompletion } from "../hooks/useJobCompletion";
import BrandLogo from "./BrandLogo";
import TimezoneProvider from "./TimezoneProvider";
import {
  LayoutDashboard, Settings, Activity, Images, ClipboardList,
  Users, LogOut, Heart, Network, GitBranch,
} from "lucide-react";
import styles from "./Layout.module.css";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, admin: false },
  { path: "/assets", label: "Assets", icon: Images, exact: false, admin: false },
  { path: "/routing", label: "Routing", icon: Network, exact: true, admin: false },
  { path: "/routing/plans", label: "Routing plans", icon: GitBranch, exact: false, admin: false },
  { path: "/jobs", label: "Jobs", icon: Activity, exact: false, admin: false },
  { path: "/logs", label: "Logs", icon: ClipboardList, exact: false, admin: false },
  { path: "/settings", label: "Settings", icon: Settings, exact: false, admin: false },
];

const DONATE_URL =
  "https://www.paypal.com/donate/?business=P9PZB949MYSD8&no_recurring=0&item_name=Thanks+for+helping+me+continuing+to+develop+this+app+%21&currency_code=CAD";

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const visibleNavItems = isAdmin
    ? [...navItems, {
      path: "/admin/users",
      label: "Users",
      icon: Users,
      exact: false,
      admin: true,
    }]
    : navItems;
  const activeIndex = visibleNavItems.reduce(
    (match, item, index) => (
      location.pathname === item.path
      || (!item.exact && item.path !== "/" && location.pathname.startsWith(`${item.path}/`))
        ? index
        : match
    ),
    0,
  );
  const [navFocusIndex, setNavFocusIndex] = useState(activeIndex);
  const navLinkRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  useJobCompletion();

  useEffect(() => {
    setNavFocusIndex(activeIndex);
  }, [activeIndex]);

  const moveNavFocus = (index: number, key: string) => {
    let nextIndex: number | null = null;
    if (key === "ArrowDown") nextIndex = (index + 1) % visibleNavItems.length;
    if (key === "ArrowUp") nextIndex = (index - 1 + visibleNavItems.length) % visibleNavItems.length;
    if (key === "Home") nextIndex = 0;
    if (key === "End") nextIndex = visibleNavItems.length - 1;
    if (nextIndex === null) return;
    setNavFocusIndex(nextIndex);
    navLinkRefs.current[nextIndex]?.focus();
  };

  return (
    <TimezoneProvider>
      <SidebarContext.Provider
        value={{
          isOpen: sidebarOpen,
          toggle: () => setSidebarOpen((open) => !open),
          close: () => setSidebarOpen(false),
        }}
      >
      <div className={styles.root}>
      <button
        type="button"
        className={[styles.backdrop, sidebarOpen ? styles.backdropVisible : ""].join(" ")}
        onClick={() => setSidebarOpen(false)}
        aria-label="Close navigation"
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <nav
        id="app-sidebar"
        className={[styles.sidebar, sidebarOpen ? styles.sidebarOpen : ""].join(" ")}
      >
        <div className={styles.logo}>
          <BrandLogo size="sidebar" />
        </div>

        <div className={styles.nav} aria-label="Primary navigation items">
          {visibleNavItems.map(({ path, label, icon: Icon, exact, admin }, index) => {
            const link = (
              <NavLink
                key={path}
                ref={(element) => { navLinkRefs.current[index] = element; }}
                to={path}
                end={exact}
                tabIndex={navFocusIndex === index ? 0 : -1}
                onFocus={() => setNavFocusIndex(index)}
                onKeyDown={(event) => {
                  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    moveNavFocus(index, event.key);
                  }
                }}
                onClick={() => {
                  setNavFocusIndex(index);
                  setSidebarOpen(false);
                }}
                className={({ isActive }) =>
                  [
                    styles.navLink,
                    admin ? styles.navAdminLink : "",
                    isActive ? (admin ? styles.navAdminLinkActive : styles.navLinkActive) : "",
                  ].join(" ")
                }
              >
                <Icon size={16} />
                <span className={styles.navLabel}>{label}</span>
              </NavLink>
            );
            return admin
              ? <div key={path} className={styles.navAdmin}>{link}</div>
              : link;
          })}
        </div>

        <div className={styles.userFooter}>
          {user && (
            <div className={styles.userInfo}>
              <div className={styles.userName}>{user.username}</div>
              <div className={styles.userEmail}>{user.email}</div>
            </div>
          )}
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noreferrer"
            className={styles.donateBtn}
          >
            <Heart size={13} className={styles.donateIcon} />
            Donate
          </a>
          <button onClick={logout} className={styles.signOutBtn}>
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </nav>

      <main className={styles.main}>
        <Outlet />
      </main>
      </div>
      </SidebarContext.Provider>
    </TimezoneProvider>
  );
}
