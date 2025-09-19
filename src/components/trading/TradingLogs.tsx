import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, RefreshCw, Activity, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface ActivityLog {
  id: string;
  event_type: string;
  event_name: string;
  symbol: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  metadata: any;
  created_at: string;
}

interface TradingLogsProps {
  logs?: any[];
  onRefresh?: () => void;
  onExport?: () => void;
}

export function TradingLogs({ 
  logs = [], 
  onRefresh,
  onExport 
}: TradingLogsProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [selectedEventType, setSelectedEventType] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const eventTypes = [
    { value: "all", label: "All Events" },
    { value: "CONNECTION", label: "Connection" },
    { value: "TRADING", label: "Trading" },
    { value: "ANALYSIS", label: "Analysis" },
    { value: "ORDER", label: "Orders" },
    { value: "POSITION", label: "Positions" },
    { value: "SYSTEM", label: "System" },
    { value: "ERROR", label: "Errors" }
  ];

  const fetchActivityLogs = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      const response = await tradingApi.getActivityLogs(
        undefined, // Remove limit to get all logs
        selectedEventType === "all" ? undefined : selectedEventType
      );
      
      if (response.status === 'success' && response.data) {
        setActivityLogs(response.data.logs);
      }
    } catch (error) {
      toast({
        title: "Failed to fetch logs",
        description: "Could not retrieve activity logs",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchActivityLogs();
  }, [selectedEventType]);

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(fetchActivityLogs, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, selectedEventType]);

  const getStatusVariant = (severity: ActivityLog["severity"]) => {
    switch (severity) {
      case "success": return "success";
      case "error": return "danger";
      case "warning": return "warning";
      default: return "info";
    }
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "CONNECTION": return "🔗";
      case "TRADING": return "📈";
      case "ANALYSIS": return "🔍";
      case "ORDER": return "📋";
      case "POSITION": return "💰";
      case "SYSTEM": return "⚙️";
      case "ERROR": return "❌";
      default: return "📝";
    }
  };

  const formatTimestamp = (timestamp: string) => {
    // Convert UTC timestamp to IST (Indian Standard Time)
    return formatInTimeZone(
      new Date(timestamp), 
      'Asia/Kolkata', 
      'HH:mm:ss'
    );
  };

  const displayLogs = activityLogs.length > 0 ? activityLogs : logs;

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5 text-primary" />
            <span>Activity Logs</span>
            <span className="text-sm text-muted-foreground">
              ({displayLogs.length} entries)
            </span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Select value={selectedEventType} onValueChange={setSelectedEventType}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eventTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAutoRefresh(!autoRefresh);
                if (!autoRefresh) fetchActivityLogs();
              }}
            >
              <RefreshCw className={`h-4 w-4 ${(autoRefresh || isLoading) ? 'animate-spin' : ''}`} />
            </Button>
            
            <Button variant="ghost" size="sm" onClick={onExport}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
          <div className="flex items-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <span>{autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}</span>
          </div>
          {isLoading && (
            <div className="flex items-center space-x-1">
              <AlertCircle className="h-3 w-3 animate-spin" />
              <span>Loading...</span>
            </div>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="space-y-2">
            {displayLogs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No activity logs available</p>
                <p className="text-sm">Start trading to see comprehensive activity logs</p>
              </div>
            ) : (
              displayLogs.map((log) => {
                // Handle both old format (from props) and new format (from API)
                const isNewFormat = 'event_type' in log;
                
                return (
                  <div
                    key={log.id}
                    className="py-1 px-2 text-sm text-foreground font-mono hover:bg-accent/30 transition-colors"
                  >
                    <span className="text-muted-foreground">
                      {isNewFormat 
                        ? formatTimestamp(log.created_at)
                        : log.timestamp
                      }
                    </span>
                    <span className="ml-2">
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}