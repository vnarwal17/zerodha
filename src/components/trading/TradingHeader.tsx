import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Activity, Settings, Power, PowerOff, LogOut, TestTube, Target } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface TradingHeaderProps {
  isConnected: boolean;
  isTrading: boolean;
  onToggleTrading: () => void;
  userName?: string;
  onLogout?: () => void;
}

export function TradingHeader({ 
  isConnected, 
  isTrading, 
  onToggleTrading,
  userName = "Demo User",
  onLogout
}: TradingHeaderProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleTestSetupDetection = async () => {
    const testSetups = [
      { symbol: "RELIANCE", type: "BUY", message: "Setup detected for RELIANCE: BUY (10 AM candle closed above 50-SMA)" },
      { symbol: "TCS", type: "SELL", message: "Setup detected for TCS: SELL (10 AM candle closed below 50-SMA)" },
      { symbol: "INFY", type: "BUY", message: "Setup detected for INFY: BUY (10 AM candle closed above 50-SMA)" }
    ];

    const currentTime = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: true 
    });

    for (const setup of testSetups) {
      try {
        const response = await tradingApi.logSetupDetection(
          setup.symbol, 
          setup.type as 'BUY' | 'SELL', 
          currentTime, 
          setup.message
        );
        
        if (response.status === 'success') {
          console.log(`Logged setup: ${response.data?.formatted_message}`);
        }
      } catch (error) {
        console.error(`Failed to log setup for ${setup.symbol}:`, error);
      }
    }
    
    toast({
      title: "Setup Detection Demo",
      description: `Logged ${testSetups.length} test setup detections. Check the Activity Logs.`,
    });
  };
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

          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigate("/test")}
            title="Test Page"
          >
            <TestTube className="h-4 w-4" />
          </Button>

          <Button 
            variant="ghost" 
            size="sm"
            onClick={handleTestSetupDetection}
            title="Test Setup Detection Logging"
          >
            <Target className="h-4 w-4" />
          </Button>
          
          {onLogout && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onLogout}
              className="text-destructive hover:text-destructive"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}