import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { tradingApi, TradingSymbol, StrategySignal } from '@/services/trading-api';
import { toast } from 'sonner';
import { Play, Square, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StrategyMonitorProps {
  selectedSymbols: TradingSymbol[];
  isLiveTrading: boolean;
}

export const StrategyMonitor: React.FC<StrategyMonitorProps> = ({ 
  selectedSymbols, 
  isLiveTrading 
}) => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [signals, setSignals] = useState<StrategySignal[]>([]);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [autoExecute, setAutoExecute] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isMonitoring && selectedSymbols.length > 0) {
      // Analyze symbols every 3 minutes (matching candle interval)
      interval = setInterval(async () => {
        await analyzeSymbols();
      }, 3 * 60 * 1000); // 3 minutes

      // Initial analysis
      analyzeSymbols();
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isMonitoring, selectedSymbols]);

  const analyzeSymbols = async () => {
    try {
      const response = await tradingApi.analyzeSymbols(selectedSymbols);
      
      if (response.status === 'success' && response.data) {
        setSignals(response.data.signals);
        setLastUpdate(new Date().toLocaleTimeString());

        // Auto-execute trades if enabled
        if (autoExecute && isLiveTrading) {
          for (const signal of response.data.signals) {
            if (signal.action === 'BUY' || signal.action === 'SELL') {
              await executeSignal(signal);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error analyzing symbols:', error);
      toast.error('Failed to analyze symbols');
    }
  };

  const executeSignal = async (signal: StrategySignal) => {
    if (signal.action === 'HOLD') return;
    
    try {
      const response = await tradingApi.executeTrade(
        signal.symbol, 
        signal.action as 'BUY' | 'SELL', 
        signal.quantity
      );

      if (response.status === 'success') {
        toast.success(`${signal.action} order placed for ${signal.symbol}`);
      } else {
        toast.error(`Failed to place ${signal.action} order for ${signal.symbol}`);
      }
    } catch (error) {
      toast.error(`Error executing trade for ${signal.symbol}`);
    }
  };

  const startMonitoring = () => {
    if (!isLiveTrading) {
      toast.error('Please start live trading first');
      return;
    }
    setIsMonitoring(true);
    toast.success('Strategy monitoring started');
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    toast.info('Strategy monitoring stopped');
  };

  const getSignalIcon = (action: string) => {
    switch (action) {
      case 'BUY':
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'SELL':
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      default:
        return <Minus className="h-4 w-4 text-gray-400" />;
    }
  };

  const getSignalBadgeVariant = (action: string) => {
    switch (action) {
      case 'BUY':
        return 'default' as const;
      case 'SELL':
        return 'destructive' as const;
      default:
        return 'secondary' as const;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Strategy Monitor
        </CardTitle>
        <CardDescription>
          Your comprehensive intraday strategy with 50-period SMA, 10 AM setup validation, and 5:1 RR
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex gap-2">
            {!isMonitoring ? (
              <Button 
                onClick={startMonitoring}
                disabled={selectedSymbols.length === 0}
                className="flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Start Monitoring
              </Button>
            ) : (
              <Button 
                onClick={stopMonitoring}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <Square className="h-4 w-4" />
                Stop Monitoring
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoExecute"
              checked={autoExecute}
              onChange={(e) => setAutoExecute(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="autoExecute" className="text-sm">
              Auto-execute trades
            </label>
          </div>
        </div>

        {lastUpdate && (
          <div className="text-sm text-muted-foreground">
            Last updated: {lastUpdate}
          </div>
        )}

        <div className="space-y-2">
          <h4 className="font-medium">Current Signals ({signals.length})</h4>
          
          {signals.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">
              {isMonitoring ? 'Analyzing symbols...' : 'Start monitoring to see signals'}
            </div>
          ) : (
            <div className="grid gap-2">
              {signals.map((signal, index) => (
                <div 
                  key={index}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getSignalIcon(signal.action)}
                    <div>
                      <div className="font-medium">{signal.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        {signal.reason}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant={getSignalBadgeVariant(signal.action)}>
                      {signal.action}
                    </Badge>
                    {signal.action !== 'HOLD' && (
                      <Button
                        size="sm"
                        onClick={() => executeSignal(signal)}
                        disabled={!isLiveTrading || autoExecute}
                      >
                        Execute
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <h5 className="font-medium text-blue-900 mb-2">Your Intraday Strategy Rules:</h5>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• 50-period SMA on 3-minute candles</li>
            <li>• 10 AM setup: Entire candle must be strictly above/below SMA</li>
            <li>• Rejection candle: Wick touches SMA, body stays on setup side</li>
            <li>• 2-candle skip period after rejection</li>
            <li>• Entry: Rejection High/Low ± 0.10, SL: ± 0.15</li>
            <li>• Target: 5:1 Risk/Reward ratio</li>
            <li>• Trading window: 10 AM - 1 PM, Force exit at 3 PM</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};