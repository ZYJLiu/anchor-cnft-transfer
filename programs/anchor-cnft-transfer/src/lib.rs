use anchor_lang::prelude::*;
use mpl_bubblegum::{
    cpi::{accounts::Transfer, transfer},
    program::Bubblegum,
};
use spl_account_compression::{program::SplAccountCompression, Noop};
declare_id!("3fWZhdMYqMLPeBJwJyu4QB1bSwmu8rjG3YQ3oVVo8Nci");

#[program]
pub mod anchor_cnft_transfer {
    use super::*;

    // Manual CPI call to the bubblegum program transfer instruction
    pub fn transfer_one<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, TransferCompressedNft<'info>>,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        nonce: u64,
        index: u32,
    ) -> Result<()> {
        // remaining_accounts are the accounts that make up the required proof
        let remaining_accounts_len = ctx.remaining_accounts.len();
        let mut accounts = Vec::with_capacity(
            8 // space for the 8 AccountMetas that are always included in (below)
            + remaining_accounts_len,
        );
        accounts.extend(vec![
            AccountMeta::new_readonly(ctx.accounts.tree_authority.key(), false),
            AccountMeta::new_readonly(ctx.accounts.leaf_owner.key(), true),
            AccountMeta::new_readonly(ctx.accounts.leaf_delegate.key(), false),
            AccountMeta::new_readonly(ctx.accounts.new_leaf_owner.key(), false),
            AccountMeta::new(ctx.accounts.merkle_tree.key(), false),
            AccountMeta::new_readonly(ctx.accounts.log_wrapper.key(), false),
            AccountMeta::new_readonly(ctx.accounts.compression_program.key(), false),
            AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
        ]);

        let transfer_discriminator: [u8; 8] = [163, 52, 200, 231, 140, 3, 69, 186];

        let mut data = Vec::with_capacity(
            8 // The length of transfer_discriminator,
            + root.len()
            + data_hash.len()
            + creator_hash.len()
            + 8 // The length of the nonce
            + 8, // The length of the index
        );
        data.extend(transfer_discriminator);
        data.extend(root);
        data.extend(data_hash);
        data.extend(creator_hash);
        data.extend(nonce.to_le_bytes());
        data.extend(index.to_le_bytes());

        let mut account_infos = Vec::with_capacity(
            8 // space for the 8 AccountInfos that are always included (below)
            + remaining_accounts_len,
        );
        account_infos.extend(vec![
            ctx.accounts.tree_authority.to_account_info(),
            ctx.accounts.leaf_owner.to_account_info(),
            ctx.accounts.leaf_delegate.to_account_info(),
            ctx.accounts.new_leaf_owner.to_account_info(),
            ctx.accounts.merkle_tree.to_account_info(),
            ctx.accounts.log_wrapper.to_account_info(),
            ctx.accounts.compression_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ]);

        // Add "accounts" (hashes) that make up the merkle proof from the remaining accounts.
        for acc in ctx.remaining_accounts.iter() {
            accounts.push(AccountMeta::new_readonly(acc.key(), false));
            account_infos.push(acc.to_account_info());
        }

        let instruction = solana_program::instruction::Instruction {
            program_id: ctx.accounts.bubblegum_program.key(),
            accounts,
            data,
        };

        msg!("manual cpi call to bubblegum program transfer instruction");
        solana_program::program::invoke(&instruction, &account_infos[..])?;

        Ok(())
    }

    // CPI call to the bubblegum program transfer instruction using mpl_bubblegum crate, fails with:
    // Error Code: LeafAuthorityMustSign. Error Number: 6025. Error Message: This transaction must be signed by either the leaf owner or leaf delegate.'
    pub fn transfer_two<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, TransferCompressedNft<'info>>,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        nonce: u64,
        index: u32,
    ) -> Result<()> {
        msg!("remaining_accounts: {:?}", ctx.remaining_accounts.to_vec());

        let mut remaining_account_infos: Vec<AccountInfo> = Vec::new();
        for acc in ctx.remaining_accounts.iter() {
            remaining_account_infos.push(acc.to_account_info());
        }

        let cpi_ctx = CpiContext::new(
            ctx.accounts.bubblegum_program.to_account_info(),
            Transfer {
                tree_authority: ctx.accounts.tree_authority.to_account_info(),
                leaf_owner: ctx.accounts.leaf_owner.to_account_info(),
                leaf_delegate: ctx.accounts.leaf_delegate.to_account_info(),
                new_leaf_owner: ctx.accounts.new_leaf_owner.to_account_info(),
                merkle_tree: ctx.accounts.merkle_tree.to_account_info(),
                log_wrapper: ctx.accounts.log_wrapper.to_account_info(),
                compression_program: ctx.accounts.compression_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        )
        .with_remaining_accounts(remaining_account_infos);

        transfer(cpi_ctx, root, data_hash, creator_hash, nonce, index)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct TransferCompressedNft<'info> {
    #[account(mut)]
    pub leaf_owner: Signer<'info>,

    #[account(mut)]
    pub leaf_delegate: Signer<'info>,

    /// CHECK:
    #[account(
        mut,
        seeds = [merkle_tree.key().as_ref()],
        bump,
        seeds::program = bubblegum_program.key()
    )]
    pub tree_authority: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub new_leaf_owner: UncheckedAccount<'info>,

    pub log_wrapper: Program<'info, Noop>,
    pub compression_program: Program<'info, SplAccountCompression>,
    pub bubblegum_program: Program<'info, Bubblegum>,
    pub system_program: Program<'info, System>,
}
