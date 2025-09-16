import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wallet, TrendingUp, TrendingDown, RefreshCw, DollarSign, PiggyBank, CreditCard } from "lucide-react";
import { useState, useEffect } from "react";
import { tradingApi } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface BalanceDisplayProps {
  isConnected: boolean;
}

interface BalanceData {
  segment: string;
  enabled: boolean;
  net: number;
  available: {
    adhoc_margin: number;
    cash: number;
    opening_balance: number;
    live_balance: number;
    collateral: number;
    intraday_payin: number;
  };
  utilised: {
    debits: number;
    exposure: number;
    m2m_realised: number;
    m2m_unrealised: number;
    option_premium: number;
    payout: number;
    span: number;
    holding_sales: number;
    turnover: number;
    liquid_collateral: number;
    stock_collateral: number;
    additional: number;
    delivery: number;
    equity: number;
  };
}

export function BalanceDisplay({ isConnected }: BalanceDisplayProps) {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const { toast } = useToast();

  const fetchBalance = async () => {
    if (!isConnected) return;
    
    setLoading(true);
    try {
      const response = await tradingApi.getBalance();
      
      if (response.status === 'success' && response.data) {
        setBalance(response.data.balance);
        setUserId(response.data.user_id);
      } else {
        toast({
          title: "Balance Fetch Failed",
          description: response.message || "Could not fetch balance",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Balance fetch error:', error);
      toast({
        title: "Error",
        description: "Failed to fetch balance data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected) {
      fetchBalance();
    }
  }, [isConnected]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            <span>Account Balance</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">Connect to Zerodha to view balance</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Wallet className="h-5 w-5 text-primary" />
            <span>Account Balance</span>
            {userId && (
              <Badge variant="secondary" className="text-xs">
                {userId}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBalance}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center py-6">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">Fetching balance...</p>
          </div>
        ) : balance ? (
          <div className="space-y-4">
            {/* Net Balance */}
            <div className="flex items-center justify-between p-4 bg-primary/5 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-primary/10 rounded-full">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Net Balance</p>
                  <p className="text-2xl font-bold">{formatCurrency(balance.net)}</p>
                </div>
              </div>
              <Badge variant={balance.net >= 0 ? "default" : "destructive"}>
                {balance.net >= 0 ? (
                  <TrendingUp className="h-3 w-3 mr-1" />
                ) : (
                  <TrendingDown className="h-3 w-3 mr-1" />
                )}
                {balance.net >= 0 ? 'Positive' : 'Negative'}
              </Badge>
            </div>

            {/* Available Funds */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <PiggyBank className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">Available</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cash:</span>
                    <span className="font-medium">{formatCurrency(balance.available.cash || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Live Balance:</span>
                    <span className="font-medium">{formatCurrency(balance.available.live_balance || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Collateral:</span>
                    <span className="font-medium">{formatCurrency(balance.available.collateral || 0)}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <CreditCard className="h-4 w-4 text-red-600" />
                  <span className="text-sm font-medium">Utilised</span>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exposure:</span>
                    <span className="font-medium">{formatCurrency(balance.utilised.exposure || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">M2M Unrealised:</span>
                    <span className={`font-medium ${(balance.utilised.m2m_unrealised || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(balance.utilised.m2m_unrealised || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">M2M Realised:</span>
                    <span className={`font-medium ${(balance.utilised.m2m_realised || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(balance.utilised.m2m_realised || 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Status */}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm text-muted-foreground">Account Status:</span>
              <Badge variant={balance.enabled ? "default" : "secondary"}>
                {balance.enabled ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No balance data available</p>
            <Button variant="outline" size="sm" onClick={fetchBalance} className="mt-2">
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}