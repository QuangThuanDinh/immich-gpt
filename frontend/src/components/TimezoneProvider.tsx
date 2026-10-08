import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getRuntimeSettings } from "../services/api";
import { formatDateTime } from "../utils/datetime";
import TimezoneContext from "../contexts/TimezoneContext";

export default function TimezoneProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["runtime-settings"],
    queryFn: getRuntimeSettings,
    staleTime: Infinity,
  });
  const timezone = data?.timezone ?? "UTC";
  const value = React.useMemo(() => ({
    timezone,
    formatDateTime: (dateTime: string | Date) => formatDateTime(dateTime, timezone),
  }), [timezone]);

  return (
    <TimezoneContext.Provider value={value}>
      {children}
    </TimezoneContext.Provider>
  );
}
