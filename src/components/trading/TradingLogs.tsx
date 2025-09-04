import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileText, Download, RefreshCw } from "lucide-react";
import { useState } from "react";

interface LogEntry {
  id: string;
  timestamp: string;
  symbol: string;
  event: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

interface TradingLogsProps {
  logs?: LogEntry[];
  onRefresh?: () => void;
  onExport?: () => void;
}

export function TradingLogs({ 
  logs = [], 
  onRefresh,
  onExport 
}: TradingLogsProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const getStatusVariant = (type: LogEntry["type"]) => {
    switch (type) {
      case "success": return "success";
      case "error": return "danger";
      case "warning": return "warning";
      default: return "info";
    }
  };

  const getEventColor = (event: string) => {
    if (event.includes("TRADE_EXECUTED")) return "text-success";
    if (event.includes("ERROR") || event.includes("SL_HIT")) return "text-destructive";
    if (event.includes("SETUP") || event.includes("REJECTION")) return "text-primary";
    return "text-muted-foreground";
  };

  return (
    <Card className="h-[500px] flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5 text-primary" />
            <span>Strategy Logs</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={autoRefresh}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onExport}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-2">
            {logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No logs available
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start space-x-3 p-3 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                >
                  <div className="text-xs text-muted-foreground font-mono mt-1 min-w-[60px]">
                    {log.timestamp}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-sm">{log.symbol}</span>
                      <StatusBadge variant={getStatusVariant(log.type)} size="sm">
                        {log.event}
                      </StatusBadge>
                    </div>
                    <div className="text-sm text-foreground">
                      {log.message}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}