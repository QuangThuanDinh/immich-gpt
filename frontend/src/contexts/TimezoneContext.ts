import React from "react";
import { formatDateTime } from "../utils/datetime";

export interface TimezoneValue {
  timezone: string;
  formatDateTime: (value: string | Date) => string;
}

const TimezoneContext = React.createContext<TimezoneValue>({
  timezone: "UTC",
  formatDateTime: (value) => formatDateTime(value, "UTC"),
});

export default TimezoneContext;
