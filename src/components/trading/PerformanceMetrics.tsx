import { useState, useEffect } from "react";
import { MetricCard } from "@/components/ui/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, DollarSign, Percent, BarChart3, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tradingApi } from "@/services/trading-api";

interface PerformanceData {
  totalPnL: number;
  totalTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  todayPnL: number;
}

interface PerformanceMetricsProps {
  isConnected: boolean;
  isTrading?: boolean;
}

export function PerformanceMetrics({ isConnected, isTrading }: PerformanceMetricsProps) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isConnected) {
      fetchPerformanceData();
      
      // Auto-refresh every 30 seconds when trading
      if (isTrading) {
        const interval = setInterval(fetchPerformanceData, 30000);
        return () => clearInterval(interval);
      }
    } else {
      setData(null);
    }
  }, [isConnected, isTrading]);

  const fetchPerformanceData = async () => {
    if (!isConnected) return;
    
    setLoading(true);
    try {
      const response = await tradingApi.getPerformanceData();
      if (response.status === 'success' && response.data) {
        setData(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch performance data:', error);
    } finally {
      setLoading(false);
    }
  };
  const formatCurrency = (amount: number) => {
    const sign = amount >= 0 ? '+' : '';
    return `${sign}₹${Math.abs(amount).toLocaleString('en-IN')}`;
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {data ? (
        <>
          <Card className="bg-gradient-success">
            <CardHeader>
              <CardTitle className="text-success-foreground">Performance Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-success-foreground/80 text-sm">Total P&L</div>
                  <div className="text-2xl font-bold text-success-foreground">
                    {formatCurrency(data.totalPnL)}
                  </div>
                </div>
                <div>
                  <div className="text-success-foreground/80 text-sm">Today's P&L</div>
                  <div className="text-2xl font-bold text-success-foreground">
                    {formatCurrency(data.todayPnL)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Trades"
              value={data.totalTrades}
              icon={BarChart3}
              description="Executed positions"
            />
            
            <MetricCard
              title="Win Rate"
              value={formatPercent(data.winRate)}
              icon={Target}
              changeType="positive"
              description="Profitable trades"
            />
            
            <MetricCard
              title="Avg Win"
              value={formatCurrency(data.avgWin)}
              icon={TrendingUp}
              changeType="positive"
              description="Per winning trade"
            />
            
            <MetricCard
              title="Avg Loss"
              value={formatCurrency(Math.abs(data.avgLoss))}
              icon={TrendingDown}
              changeType="negative"
              description="Per losing trade"
            />
            
            <MetricCard
              title="Max Drawdown"
              value={formatCurrency(Math.abs(data.maxDrawdown))}
              icon={TrendingDown}
              changeType="negative"
              description="Peak to trough"
            />
            
            <MetricCard
              title="Sharpe Ratio"
              value={data.sharpeRatio.toFixed(2)}
              icon={BarChart3}
              changeType="positive"
              description="Risk-adjusted return"
            />
            
            <MetricCard
              title="Risk:Reward"
              value="1:5"
              icon={DollarSign}
              description="Target ratio"
            />
            
            <MetricCard
              title="Success Rate"
              value={formatPercent(data.winRate)}
              icon={Percent}
              changeType="positive"
              description="Above 65% target"
            />
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          {isConnected ? (
            <div className="space-y-4">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <div>
                <p className="text-muted-foreground">
                  {loading ? "Loading performance data..." : "No trading activity yet"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Start trading to see your performance metrics
                </p>
              </div>
              <Button
                variant="outline"
                onClick={fetchPerformanceData}
                disabled={loading}
                className="mt-4"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Loading...' : 'Refresh Data'}
              </Button>
            </div>
          ) : (
            <div className="text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No performance data available</p>
              <p className="text-sm">Connect to Zerodha and start trading to see metrics</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}