import { useState, useEffect } from "react";
import { TradingHeader } from "@/components/trading/TradingHeader";
import { BrokerConnection } from "@/components/trading/BrokerConnection";
import { BalanceDisplay } from "@/components/trading/BalanceDisplay";
import { SymbolSelection } from "@/components/trading/SymbolSelection";
import { TradingSettingsComponent } from "@/components/trading/TradingSettingsComponent";
import { StrategyOverview } from "@/components/trading/StrategyOverview";
import { LivePositions } from "@/components/trading/LivePositions";
import { MarketStatus } from "@/components/trading/MarketStatus";
import { TradingLogs } from "@/components/trading/TradingLogs";
import { PerformanceMetrics } from "@/components/trading/PerformanceMetrics";
import { StrategyMonitor } from "@/components/trading/StrategyMonitor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tradingApi, TradingSymbol, LiveStatus } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isTrading, setIsTrading] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<TradingSymbol[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Real-time status updates
  useEffect(() => {
    if (isTrading) {
      const interval = setInterval(async () => {
        try {
          const response = await tradingApi.getLiveStatus();
          if (response.status === 'success' && response.data) {
            setLiveStatus(response.data.live_status);
          }
        } catch (error) {
          console.error('Failed to fetch live status:', error);
        }
      }, 5000); // Update every 5 seconds

      setRefreshInterval(interval);
      return () => {
        if (interval) clearInterval(interval);
      };
    } else {
      if (refreshInterval) {
        clearInterval(refreshInterval);
        setRefreshInterval(null);
      }
    }
  }, [isTrading]);

  const handleConnectionChange = (connected: boolean, userData?: any) => {
    setIsConnected(connected);
    if (connected && userData) {
      setUserInfo(userData);
      toast({
        title: "Connected",
        description: `Successfully connected as ${userData.user_id}`,
      });
    } else {
      setUserInfo(null);
      setIsTrading(false);
      setLiveStatus(null);
    }
  };

  const handleToggleTrading = async () => {
    if (!isConnected) {
      toast({
        title: "Connection Required",
        description: "Please connect to your broker first.",
        variant: "destructive",
      });
      return;
    }

    if (selectedSymbols.length === 0 && !isTrading) {
      toast({
        title: "No Symbols Selected",
        description: "Please select at least one symbol to trade.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isTrading) {
        // Stop trading
        const response = await tradingApi.stopLiveTrading();
        if (response.status === 'success') {
          setIsTrading(false);
          setLiveStatus(null);
          toast({
            title: "Trading Stopped",
            description: "Live trading has been stopped successfully.",
          });
        } else {
          toast({
            title: "Failed to Stop Trading",
            description: response.message || "Unknown error occurred",
            variant: "destructive",
          });
        }
      } else {
        // Start trading
        const response = await tradingApi.startLiveTrading(selectedSymbols);
        if (response.status === 'success') {
          setIsTrading(true);
          toast({
            title: "Trading Started",
            description: `Live strategy monitoring activated for ${selectedSymbols.length} symbols.`,
          });
        } else {
          toast({
            title: "Failed to Start Trading",
            description: response.message || "Unknown error occurred",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      toast({
        title: "Trading Operation Failed",
        description: "Failed to communicate with trading engine",
        variant: "destructive",
      });
    }
  };

  const handleClosePosition = async (positionId: string) => {
    toast({
      title: "Position Close Requested",
      description: `Closing position ${positionId}...`,
    });
    // Note: This would need a specific API endpoint to close individual positions
    // For now, it's just a UI feedback
  };

  const handleRefreshLogs = async () => {
    try {
      const response = await tradingApi.getLiveStatus();
      if (response.status === 'success' && response.data) {
        setLiveStatus(response.data.live_status);
        toast({
          title: "Logs Refreshed",
          description: "Strategy logs have been updated.",
        });
      }
    } catch (error) {
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh logs",
        variant: "destructive",
      });
    }
  };

  const handleExportLogs = async () => {
    if (!liveStatus?.strategy_logs) {
      toast({
        title: "No Data",
        description: "No logs available to export",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await tradingApi.exportTrades(liveStatus.strategy_logs);
      if (response.status === 'success' && response.data) {
        // Create download link
        const url = window.URL.createObjectURL(response.data);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'trading_logs.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast({
          title: "Export Complete",
          description: "Trading logs downloaded successfully.",
        });
      }
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export logs",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TradingHeader
        isConnected={isConnected}
        isTrading={isTrading}
        onToggleTrading={handleToggleTrading}
        userName={userInfo?.user_name || userInfo?.user_id || "Trader"}
      />

      <main className="container mx-auto px-6 py-6 space-y-6">
        <Tabs defaultValue="setup" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <BrokerConnection
                isConnected={isConnected}
                onConnectionChange={handleConnectionChange}
              />
              <BalanceDisplay isConnected={isConnected} />
              <MarketStatus
                isMarketOpen={liveStatus?.market_open}
              />
            </div>
            
            <SymbolSelection
              selectedSymbols={selectedSymbols}
              onSymbolsChange={setSelectedSymbols}
              isConnected={isConnected}
            />
          </TabsContent>

          <TabsContent value="dashboard" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <StrategyOverview />
              <BalanceDisplay isConnected={isConnected} />
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <StrategyMonitor 
                selectedSymbols={selectedSymbols}
                isLiveTrading={isTrading}
              />
              <MarketStatus
                isMarketOpen={liveStatus?.market_open}
              />
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
              <LivePositions 
                positions={liveStatus?.positions_detail?.map(pos => ({
                  id: pos.symbol,
                  symbol: pos.symbol,
                  direction: pos.direction,
                  entryPrice: pos.entry_price,
                  currentPrice: pos.current_price || pos.entry_price,
                  stopLoss: pos.stop_loss,
                  target: pos.target,
                  quantity: pos.quantity,
                  status: pos.status as "active" | "closed",
                  unrealizedPnl: pos.unrealized_pnl,
                  entryTime: pos.entry_time,
                }))}
                onClosePosition={handleClosePosition} 
              />
            </div>
          </TabsContent>

          <TabsContent value="positions" className="space-y-6">
            <LivePositions 
              positions={liveStatus?.positions_detail?.map(pos => ({
                id: pos.symbol,
                symbol: pos.symbol,
                direction: pos.direction,
                entryPrice: pos.entry_price,
                currentPrice: pos.current_price || pos.entry_price,
                stopLoss: pos.stop_loss,
                target: pos.target,
                quantity: pos.quantity,
                status: pos.status as "active" | "closed",
                unrealizedPnl: pos.unrealized_pnl,
                entryTime: pos.entry_time,
              }))}
              onClosePosition={handleClosePosition} 
            />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceMetrics isConnected={isConnected} isTrading={isTrading} />
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            <TradingLogs 
              logs={liveStatus?.strategy_logs?.map((log, index) => ({
                id: index.toString(),
                timestamp: log.timestamp,
                symbol: log.symbol,
                event: log.event,
                message: log.message,
                type: log.event.includes('ERROR') ? 'error' as const :
                      log.event.includes('TRADE_EXECUTED') ? 'success' as const :
                      log.event.includes('WARNING') ? 'warning' as const : 'info' as const
              }))}
              onRefresh={handleRefreshLogs}
              onExport={handleExportLogs}
            />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <TradingSettingsComponent isConnected={isConnected} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;