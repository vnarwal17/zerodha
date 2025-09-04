import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Clock, Calendar, TrendingUp, Activity } from "lucide-react";
import { useEffect, useState } from "react";

interface MarketStatusProps {
  isMarketOpen?: boolean;
  nextMarketEvent?: string;
}

export function MarketStatus({ 
  isMarketOpen = true, 
  nextMarketEvent = "Market closes at 3:30 PM" 
}: MarketStatusProps) {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Kolkata'
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  };

  const getMarketPhase = () => {
    const hour = currentTime.getHours();
    const minute = currentTime.getMinutes();
    const currentMinutes = hour * 60 + minute;
    
    const marketOpen = 9 * 60 + 15; // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    
    if (currentMinutes < marketOpen) {
      return { phase: "Pre-market", color: "warning" as const };
    } else if (currentMinutes >= marketOpen && currentMinutes < marketClose) {
      return { phase: "Market Open", color: "success" as const };
    } else {
      return { phase: "After-market", color: "neutral" as const };
    }
  };

  const marketPhase = getMarketPhase();

  return (
    <Card className="bg-gradient-to-br from-card to-card/80">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Activity className="h-5 w-5 text-primary" />
          <span>Market Status</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-mono font-bold">
                {formatTime(currentTime)}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">IST</div>
          </div>
          
          <StatusBadge variant={marketPhase.color} size="lg">
            {marketPhase.phase}
          </StatusBadge>
        </div>

        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{formatDate(currentTime)}</span>
          </div>
          
          <div className="flex items-center space-x-2 text-sm">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">{nextMarketEvent}</span>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Market Open</div>
              <div className="font-medium">9:15 AM</div>
            </div>
            <div>
              <div className="text-muted-foreground">Market Close</div>
              <div className="font-medium">3:30 PM</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}