import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { tradingApi } from '@/services/trading-api';
import { toast } from 'sonner';
import { RefreshCw, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface OrderStatus {
  order_id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  quantity: number;
  status: 'PENDING' | 'COMPLETE' | 'REJECTED' | 'CANCELLED';
  price?: number;
  timestamp: string;
  message?: string;
}

interface OrderMonitorProps {
  isLiveTrading: boolean;
}

export const OrderMonitor: React.FC<OrderMonitorProps> = ({ isLiveTrading }) => {
  const [orders, setOrders] = useState<OrderStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isLiveTrading) {
      // Refresh order status every 30 seconds when live trading
      interval = setInterval(() => {
        refreshOrderStatus();
      }, 30000);

      // Initial load
      refreshOrderStatus();
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveTrading]);

  const refreshOrderStatus = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      // Get activity logs to track order status
      const response = await tradingApi.getActivityLogs(50, 'order');
      
      if (response.status === 'success' && response.data) {
        // Parse order information from logs
        const orderUpdates: OrderStatus[] = response.data.logs
          .filter((log: any) => log.event_type === 'order')
          .map((log: any) => ({
            order_id: log.metadata?.order_id || 'unknown',
            symbol: log.symbol || 'unknown',
            action: log.metadata?.action || 'BUY',
            quantity: log.metadata?.quantity || 0,
            status: log.metadata?.status || 'PENDING',
            price: log.metadata?.price,
            timestamp: log.created_at,
            message: log.message
          }))
          .slice(0, 20); // Keep last 20 orders

        setOrders(orderUpdates);
        setLastUpdate(new Date().toLocaleTimeString());
      }
    } catch (error) {
      console.error('Error refreshing order status:', error);
      toast.error('Failed to refresh order status');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETE':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'REJECTED':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'CANCELLED':
        return <XCircle className="h-4 w-4 text-yellow-600" />;
      case 'PENDING':
      default:
        return <Clock className="h-4 w-4 text-blue-600" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'COMPLETE':
        return 'default' as const;
      case 'REJECTED':
        return 'destructive' as const;
      case 'CANCELLED':
        return 'secondary' as const;
      case 'PENDING':
      default:
        return 'outline' as const;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getSuccessRate = () => {
    if (orders.length === 0) return 0;
    const completed = orders.filter(o => o.status === 'COMPLETE').length;
    return Math.round((completed / orders.length) * 100);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Order Monitor
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshOrderStatus}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
        <CardDescription>
          Real-time order execution monitoring and status tracking
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div>Total Orders: <span className="font-semibold">{orders.length}</span></div>
            <div>Success Rate: <span className="font-semibold text-green-600">{getSuccessRate()}%</span></div>
          </div>
          {lastUpdate && (
            <div className="text-muted-foreground">
              Last updated: {lastUpdate}
            </div>
          )}
        </div>

        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {orders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {isLiveTrading ? 'No orders yet. Orders will appear here when trades are executed.' : 'Start live trading to monitor orders'}
              </div>
            ) : (
              orders.map((order, index) => (
                <div 
                  key={`${order.order_id}-${index}`}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    {getStatusIcon(order.status)}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{order.symbol}</span>
                        <Badge variant={order.action === 'BUY' ? 'default' : 'destructive'} className="text-xs">
                          {order.action}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          Qty: {order.quantity}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Order ID: {order.order_id}
                      </div>
                      {order.message && (
                        <div className="text-xs text-muted-foreground max-w-md truncate">
                          {order.message}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="text-right space-y-1">
                    <Badge variant={getStatusBadgeVariant(order.status)}>
                      {order.status}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(order.timestamp)}
                    </div>
                    {order.price && (
                      <div className="text-xs font-medium">
                        ₹{order.price.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {orders.length > 0 && (
          <div className="pt-2 border-t">
            <div className="grid grid-cols-4 gap-4 text-center text-sm">
              <div>
                <div className="font-semibold text-blue-600">
                  {orders.filter(o => o.status === 'PENDING').length}
                </div>
                <div className="text-muted-foreground">Pending</div>
              </div>
              <div>
                <div className="font-semibold text-green-600">
                  {orders.filter(o => o.status === 'COMPLETE').length}
                </div>
                <div className="text-muted-foreground">Complete</div>
              </div>
              <div>
                <div className="font-semibold text-red-600">
                  {orders.filter(o => o.status === 'REJECTED').length}
                </div>
                <div className="text-muted-foreground">Rejected</div>
              </div>
              <div>
                <div className="font-semibold text-yellow-600">
                  {orders.filter(o => o.status === 'CANCELLED').length}
                </div>
                <div className="text-muted-foreground">Cancelled</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};