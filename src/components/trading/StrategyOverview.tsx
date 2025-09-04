import { MetricCard } from "@/components/ui/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Clock, Target, Shield, DollarSign } from "lucide-react";

interface StrategyConfig {
  smaPeriod: number;
  entryOffset: number;
  slOffset: number;
  riskRewardRatio: number;
  minWickPercent: number;
  positionSize: number;
}

const defaultConfig: StrategyConfig = {
  smaPeriod: 50,
  entryOffset: 0.10,
  slOffset: 0.15,
  riskRewardRatio: 5,
  minWickPercent: 15,
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
            Advanced SMA-based rejection strategy with 10 AM setup detection, 
            precise entry timing, and risk-managed position sizing.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          title="SMA Period"
          value={config.smaPeriod}
          icon={TrendingUp}
          description="Moving average period"
        />
        
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