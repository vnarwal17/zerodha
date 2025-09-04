import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Activity, Settings, Power, PowerOff } from "lucide-react";

interface TradingHeaderProps {
  isConnected: boolean;
  isTrading: boolean;
  onToggleTrading: () => void;
  userName?: string;
}

export function TradingHeader({ 
  isConnected, 
  isTrading, 
  onToggleTrading,
  userName = "Demo User"
}: TradingHeaderProps) {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              TradingBot Pro
            </h1>
          </div>
          
          <StatusBadge 
            variant={isConnected ? "success" : "danger"}
            className="animate-pulse"
          >
            {isConnected ? "Connected" : "Disconnected"}
          </StatusBadge>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-sm text-muted-foreground">
            Welcome, <span className="font-medium text-foreground">{userName}</span>
          </div>
          
          <Button
            onClick={onToggleTrading}
            variant={isTrading ? "destructive" : "default"}
            size="sm"
            className={isTrading ? "animate-pulse-danger" : "shadow-primary"}
          >
            {isTrading ? (
              <>
                <PowerOff className="h-4 w-4 mr-2" />
                Stop Trading
              </>
            ) : (
              <>
                <Power className="h-4 w-4 mr-2" />
                Start Trading
              </>
            )}
          </Button>

          <Button variant="ghost" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}