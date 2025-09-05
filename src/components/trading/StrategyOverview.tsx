import { MetricCard } from "@/components/ui/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Clock, Target, Shield, DollarSign, BarChart3, Timer, Calendar } from "lucide-react";

interface StrategyConfig {
  candleInterval: number;
  smaPeriod: number;
  setupTime: string;
  entryOffset: number;
  slOffset: number;
  riskRewardRatio: number;
  minWickPercent: number;
  skipCandles: number;
  entryWindow: string;
  forceExit: string;
  positionSize: number;
}

const defaultConfig: StrategyConfig = {
  candleInterval: 3,
  smaPeriod: 50,
  setupTime: "9:15 AM IST",
  entryOffset: 0.10,
  slOffset: 0.15,
  riskRewardRatio: 5,
  minWickPercent: 15,
  skipCandles: 2,
  entryWindow: "1:00 PM IST",
  forceExit: "3:00 PM IST",
  positionSize: 100000,
};

export function StrategyOverview({ config = defaultConfig }: { config?: StrategyConfig }) {
  return (
    <div className="space-y-6">
      <Card className="bg-gradient-hero">
        <CardHeader>
          <CardTitle className="text-primary">Live Intraday Strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            3-minute candle SMA rejection strategy. Setup at market open (9:15-9:18 AM IST), 
            wick rejection confirmation, 2-candle skip period, and 5:1 risk-reward with daily exit at 3:00 PM IST.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          title="Candle Interval"
          value={`${config.candleInterval} min`}
          icon={BarChart3}
          description="Chart timeframe"
        />
        
        <MetricCard
          title="Setup Time"
          value={config.setupTime}
          icon={Clock}
          description="9:15-9:18 AM IST"
        />
        
        <MetricCard
          title="SMA Period"
          value={config.smaPeriod}
          icon={TrendingUp}
          description="Moving average"
        />
        
        <MetricCard
          title="Skip Candles"
          value={config.skipCandles}
          icon={Timer}
          description="After rejection"
        />
        
        <MetricCard
          title="Entry Window"
          value={`Until ${config.entryWindow}`}
          icon={Calendar}
          description="Trade entry limit"
        />
        
        <MetricCard
          title="Force Exit"
          value={config.forceExit}
          icon={Clock}
          description="End of day exit"
        />
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Entry Offset"
          value={`₹${config.entryOffset}`}
          icon={Target}
          description="Above/below rejection"
        />
        
        <MetricCard
          title="SL Offset"
          value={`₹${config.slOffset}`}
          icon={Shield}
          description="Risk protection"
        />
        
        <MetricCard
          title="Risk:Reward"
          value={`1:${config.riskRewardRatio}`}
          icon={TrendingDown}
          description="Profit target ratio"
        />
        
        <MetricCard
          title="Min Wick"
          value={`${config.minWickPercent}%`}
          icon={Clock}
          description="Of candle range"
        />
        
        <MetricCard
          title="Position Size"
          value={`₹${(config.positionSize / 1000).toFixed(0)}K`}
          icon={DollarSign}
          description="Per trade capital"
        />
      </div>
    </div>
  );
}