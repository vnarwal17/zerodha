import { useState } from "react";
import { TradingHeader } from "@/components/trading/TradingHeader";
import { StrategyOverview } from "@/components/trading/StrategyOverview";
import { LivePositions } from "@/components/trading/LivePositions";
import { MarketStatus } from "@/components/trading/MarketStatus";
import { TradingLogs } from "@/components/trading/TradingLogs";
import { PerformanceMetrics } from "@/components/trading/PerformanceMetrics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

const Index = () => {
  const [isConnected, setIsConnected] = useState(true);
  const [isTrading, setIsTrading] = useState(false);
  const { toast } = useToast();

  const handleToggleTrading = () => {
    if (!isConnected) {
      toast({
        title: "Connection Required",
        description: "Please connect to your broker first.",
        variant: "destructive",
      });
      return;
    }

    setIsTrading(!isTrading);
    toast({
      title: isTrading ? "Trading Stopped" : "Trading Started",
      description: isTrading 
        ? "All positions will be monitored until market close." 
        : "Live strategy monitoring activated.",
      variant: isTrading ? "destructive" : "default",
    });
  };

  const handleClosePosition = (positionId: string) => {
    toast({
      title: "Position Closed",
      description: `Position ${positionId} has been closed manually.`,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <TradingHeader
        isConnected={isConnected}
        isTrading={isTrading}
        onToggleTrading={handleToggleTrading}
        userName="Trader Pro"
      />

      <main className="container mx-auto px-6 py-6 space-y-6">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="positions">Live Positions</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="logs">Strategy Logs</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-6">
            <StrategyOverview />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <LivePositions onClosePosition={handleClosePosition} />
              </div>
              <div className="space-y-6">
                <MarketStatus />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="positions" className="space-y-6">
            <LivePositions onClosePosition={handleClosePosition} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceMetrics />
          </TabsContent>

          <TabsContent value="logs" className="space-y-6">
            <TradingLogs 
              onRefresh={() => {
                toast({
                  title: "Logs Refreshed",
                  description: "Strategy logs have been updated.",
                });
              }}
              onExport={() => {
                toast({
                  title: "Export Started",
                  description: "Downloading strategy logs...",
                });
              }}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;