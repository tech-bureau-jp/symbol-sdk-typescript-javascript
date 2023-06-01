/*
 * Copyright 2019 NEM
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';
import { Addresses, AsyncUtils, BootstrapService, ConfigLoader, Logger, LoggerFactory, StartParams } from 'symbol-bootstrap';
import { IListener, RepositoryFactory, RepositoryFactoryHttp } from '../../src/infrastructure';
import { UInt64 } from '../../src/model';
import { Account } from '../../src/model/account';
import { Currency, Mosaic } from '../../src/model/mosaic';
import { NetworkType } from '../../src/model/network';
import { SignedTransaction, Transaction } from '../../src/model/transaction';
import { TransactionService } from '../../src/service';

export class IntegrationTestHelper {
    public apiUrl: string;
    public repositoryFactory: RepositoryFactory;
    public accounts: Account[];
    public account: Account;
    public account2: Account;
    public account3: Account;
    public multisigAccount: Account;
    public cosignAccount1: Account;
    public cosignAccount2: Account;
    public cosignAccount3: Account;
    public cosignAccount4: Account;
    public networkType: NetworkType;
    public generationHash: string;
    public listener: IListener;
    public maxFee: UInt64;
    public harvestingAccount: Account;
    public transactionService: TransactionService;
    public networkCurrency: Currency;
    public logger: Logger = LoggerFactory.getLogger('info');
    public service = new BootstrapService(this.logger);
    public config: StartParams;
    public startEachTime = true;
    public epochAdjustment: number;
    public bootstrapAddresses: Addresses;

    private async loadBootstrap(): Promise<{ accounts: string[]; apiUrl: string; addresses: Addresses }> {
        const target = process.env.REST_DEV ? '../catapult-rest/rest/target' : 'target/bootstrap-test';
        console.log('Loading bootstrap server');
        const addresses = new ConfigLoader(this.logger).loadExistingAddresses(target, false);
        return this.toAccounts(addresses);
    }

    private toAccounts(addresses: Addresses): { accounts: string[]; apiUrl: string; addresses: Addresses } {
        const accounts = addresses?.mosaics?.[0].accounts.map((n) => n.privateKey).filter((privateKey) => privateKey) as string[];
        if (!accounts) {
            throw new Error('Nemesis accounts could not be loaded!');
        }
        return { accounts, apiUrl: 'http://localhost:3000', addresses };
    }

    async close(): Promise<void> {
        if (this.listener && this.listener.isOpen()) await this.listener.close();
        if (this.config && this.startEachTime) {
            console.log('Stopping bootstrap server....');
            await this.service.stop(this.config);
            await AsyncUtils.sleep(2000);
        }
    }

    async start({ openListener }: { openListener: boolean }): Promise<IntegrationTestHelper> {
        // await this.service.stop(this.config);
        const config = await this.loadBootstrap();
        const accounts = config.accounts;
        this.bootstrapAddresses = config.addresses;
        this.apiUrl = config.apiUrl;
        this.repositoryFactory = new RepositoryFactoryHttp(this.apiUrl);
        this.transactionService = new TransactionService(
            this.repositoryFactory.createTransactionRepository(),
            this.repositoryFactory.createReceiptRepository(),
        );

        this.networkType = await firstValueFrom(this.repositoryFactory.getNetworkType());
        this.generationHash = await firstValueFrom(this.repositoryFactory.getGenerationHash());
        this.epochAdjustment = await firstValueFrom(this.repositoryFactory.getEpochAdjustment());

        let index = 0;
        this.accounts = accounts.map((account) => Account.createFromPrivateKey(account, this.networkType));
        this.account = this.accounts[index++];
        this.account2 = this.accounts[index++];
        this.account3 = this.accounts[index++];
        this.multisigAccount = this.accounts[index++];
        this.cosignAccount1 = this.accounts[index++];
        this.cosignAccount2 = this.accounts[index++];
        this.cosignAccount3 = this.accounts[index++];
        this.cosignAccount4 = this.accounts[index++];
        this.harvestingAccount = this.accounts[index++];

        this.listener = this.repositoryFactory.createListener();

        // What would be the best maxFee? In the future we will load the fee multiplier from rest.
        this.maxFee = UInt64.fromUint(1000000);
        this.networkCurrency = (await firstValueFrom(this.repositoryFactory.getCurrencies())).currency;

        if (openListener) {
            await this.listener.open();
        }
        return this;
    }

    createCurrency(amount: number, isRelative = true): Mosaic {
        return isRelative ? this.networkCurrency.createRelative(amount) : this.networkCurrency.createAbsolute(amount);
    }

    announce(signedTransaction: SignedTransaction): Promise<Transaction> {
        console.log(`Announcing transaction: ${signedTransaction.type}`);
        return firstValueFrom(
            this.transactionService.announce(signedTransaction, this.listener).pipe(
                map((t) => {
                    console.log(`Transaction ${signedTransaction.type} confirmed`);
                    return t;
                }),
            ),
        );
    }

    public static sleep(ms: number): Promise<void> {
        // Create a promise that rejects in <ms> milliseconds
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(undefined);
            }, ms);
        });
    }
}
