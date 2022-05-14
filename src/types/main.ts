export interface AlchemyAddressActivityWebHook {
  webhookId: string;
  id: string;
  createdAt: string;
  type: 'ADDRESS_ACTIVITY';
  event: {
    network: string;
    activity: AlchemyAddressActivity[];
  };
}

export interface AlchemyAddressActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string;
  hash: string;
  value: number;
  asset: string;
  category: 'external' | 'internal' | 'token';
}
