import { useEffect, useRef } from "react";
import { useGraphiQL } from "@graphiql/react";
import { QUERY_RAN_EVENT } from "../lib/events";

// Renders nothing -- just watches GraphiQL's shared isFetching state (only
// readable from inside the GraphiQLProvider tree) and dispatches a window
// event on completion, so components outside that tree (the stats
// dashboard) can refetch without any prop-drilling between them.
export default function QueryRanBridge() {
  const isFetching = useGraphiQL((state) => state.isFetching);
  const wasFetching = useRef(isFetching);

  useEffect(() => {
    if (wasFetching.current && !isFetching) {
      window.dispatchEvent(new Event(QUERY_RAN_EVENT));
    }
    wasFetching.current = isFetching;
  }, [isFetching]);

  return null;
}
