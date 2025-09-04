import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Target, Shield, X } from "lucide-react";

interface Position {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  target: number;
  quantity: number;
  status: "active" | "closed";
  unrealizedPnl: number;
  entryTime: string;
}

interface LivePositionsProps {
  positions?: Position[];
  onClosePosition?: (positionId: string) => void;
}

export function LivePositions({ 
  positions = [], 
  onClosePosition 
}: LivePositionsProps) {
  const formatCurrency = (amount: number) => `₹${amount.toFixed(2)}`;
  const formatPnL = (pnl: number) => `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(0)}`;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Live Positions</span>
          </CardTitle>
          <Badge variant="secondary">{positions.length} Active</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {positions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active positions
            </div>
          ) : (
            positions.map((position) => (
              <div
                key={position.id}
                className="border border-border rounded-lg p-4 space-y-3 hover:bg-accent/50 transition-colors"
              >
                {/* Header Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="font-semibold text-lg">{position.symbol}</span>
                    <StatusBadge 
                      variant={position.direction === "long" ? "bull" : "bear"}
                    >
                      {position.direction === "long" ? (
                        <>
                          <TrendingUp className="h-3 w-3 mr-1" />
                          LONG
                        </>
                      ) : (
                        <>
                          <TrendingDown className="h-3 w-3 mr-1" />
                          SHORT
                        </>
                      )}
                    </StatusBadge>
                    <span className="text-sm text-muted-foreground">
                      {position.entryTime}
                    </span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <StatusBadge 
                      variant={position.unrealizedPnl >= 0 ? "success" : "danger"}
                    >
                      {formatPnL(position.unrealizedPnl)}
                    </StatusBadge>
                    {onClosePosition && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onClosePosition(position.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Price Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Entry</div>
                    <div className="font-medium">{formatCurrency(position.entryPrice)}</div>
                  </div>
                  
                  <div>
                    <div className="text-muted-foreground">Current</div>
                    <div className="font-medium">{formatCurrency(position.currentPrice)}</div>
                  </div>
                  
                  <div>
                    <div className="text-muted-foreground flex items-center">
                      <Shield className="h-3 w-3 mr-1" />
                      Stop Loss
                    </div>
                    <div className="font-medium text-destructive">
                      {formatCurrency(position.stopLoss)}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-muted-foreground flex items-center">
                      <Target className="h-3 w-3 mr-1" />
                      Target
                    </div>
                    <div className="font-medium text-success">
                      {formatCurrency(position.target)}
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-muted-foreground">Quantity</div>
                    <div className="font-medium">{position.quantity} shares</div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Stop Loss</span>
                    <span>Target</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all ${
                        position.unrealizedPnl >= 0 ? 'bg-success' : 'bg-destructive'
                      }`}
                      style={{ 
                        width: `${Math.min(Math.max(
                          ((position.currentPrice - position.stopLoss) / 
                           (position.target - position.stopLoss)) * 100, 0
                        ), 100)}%` 
                      }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}