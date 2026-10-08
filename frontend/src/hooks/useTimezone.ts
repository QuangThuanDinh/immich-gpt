import React from "react";
import TimezoneContext from "../contexts/TimezoneContext";

export function useTimezone() {
  return React.useContext(TimezoneContext);
}
