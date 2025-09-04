import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, TrendingUp, Building2, Star } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { tradingApi, TradingSymbol } from "@/services/trading-api";
import { useToast } from "@/hooks/use-toast";

interface SymbolSelectionProps {
  selectedSymbols: TradingSymbol[];
  onSymbolsChange: (symbols: TradingSymbol[]) => void;
  isConnected: boolean;
}

export function SymbolSelection({ 
  selectedSymbols, 
  onSymbolsChange, 
  isConnected 
}: SymbolSelectionProps) {
  const [allSymbols, setAllSymbols] = useState<TradingSymbol[]>([]);
  const [nifty50Symbols, setNifty50Symbols] = useState<string[]>([]);
  const [bankNiftySymbols, setBankNiftySymbols] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("nifty50");
  const { toast } = useToast();

  useEffect(() => {
    if (isConnected) {
      loadInstruments();
    }
  }, [isConnected]);

  const loadInstruments = async () => {
    setLoading(true);
    try {
      const response = await tradingApi.getInstruments();
      if (response.status === 'success' && response.data) {
        setAllSymbols(response.data.instruments);
        setNifty50Symbols(response.data.nifty50_stocks);
        setBankNiftySymbols(response.data.banknifty_stocks);
      } else {
        toast({
          title: "Failed to load instruments",
          description: response.message || "Could not fetch trading symbols",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error loading symbols",
        description: "Failed to connect to trading platform",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredSymbols = useMemo(() => {
    let symbols = allSymbols;
    
    // Filter by tab
    if (activeTab === "nifty50") {
      symbols = symbols.filter(s => s.is_nifty50);
    } else if (activeTab === "banknifty") {
      symbols = symbols.filter(s => s.is_banknifty);
    }
    
    // Filter by search term
    if (searchTerm) {
      symbols = symbols.filter(s => 
        s.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    return symbols;
  }, [allSymbols, activeTab, searchTerm]);

  const isSymbolSelected = (symbol: TradingSymbol) => {
    return selectedSymbols.some(s => s.symbol === symbol.symbol);
  };

  const toggleSymbol = (symbol: TradingSymbol) => {
    if (isSymbolSelected(symbol)) {
      onSymbolsChange(selectedSymbols.filter(s => s.symbol !== symbol.symbol));
    } else {
      onSymbolsChange([...selectedSymbols, symbol]);
    }
  };

  const selectAll = () => {
    const newSelections = filteredSymbols.filter(symbol => !isSymbolSelected(symbol));
    onSymbolsChange([...selectedSymbols, ...newSelections]);
  };

  const clearAll = () => {
    const remainingSymbols = selectedSymbols.filter(selected => 
      !filteredSymbols.some(filtered => filtered.symbol === selected.symbol)
    );
    onSymbolsChange(remainingSymbols);
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            <span>Symbol Selection</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Connect to your broker to select trading symbols
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span>Symbol Selection</span>
          </CardTitle>
          <div className="flex items-center space-x-2">
            <Badge variant="secondary">
              {selectedSymbols.length} selected
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={loadInstruments}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbols..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="nifty50" className="flex items-center space-x-1">
              <Star className="h-3 w-3" />
              <span>Nifty 50</span>
            </TabsTrigger>
            <TabsTrigger value="banknifty" className="flex items-center space-x-1">
              <Building2 className="h-3 w-3" />
              <span>Bank Nifty</span>
            </TabsTrigger>
            <TabsTrigger value="all">All Stocks</TabsTrigger>
          </TabsList>

          <div className="flex justify-between items-center mt-4">
            <div className="text-sm text-muted-foreground">
              {filteredSymbols.length} symbols available
            </div>
            <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="outline" size="sm" onClick={clearAll}>
                Clear All
              </Button>
            </div>
          </div>

          <TabsContent value={activeTab} className="mt-4">
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {filteredSymbols.map((symbol) => (
                  <div
                    key={symbol.symbol}
                    className="flex items-center space-x-3 p-2 border border-border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      checked={isSymbolSelected(symbol)}
                      onCheckedChange={() => toggleSymbol(symbol)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">{symbol.symbol}</span>
                        {symbol.is_nifty50 && (
                          <Badge variant="secondary">N50</Badge>
                        )}
                        {symbol.is_banknifty && (
                          <Badge variant="secondary">BN</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        {symbol.name}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {symbol.token}
                    </div>
                  </div>
                ))}
                
                {filteredSymbols.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No symbols found matching your search
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {selectedSymbols.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="text-sm font-medium mb-2">Selected Symbols:</div>
            <div className="flex flex-wrap gap-1">
              {selectedSymbols.map((symbol) => (
                <Badge
                  key={symbol.symbol}
                  variant="secondary"
                  className="cursor-pointer"
                  onClick={() => toggleSymbol(symbol)}
                >
                  {symbol.symbol} ×
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}